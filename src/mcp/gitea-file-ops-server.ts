#!/usr/bin/env node
// Gitea File Operations MCP Server — the Gitea counterpart of
// github-file-ops-server.ts. Commits/deletes files in a single atomic commit
// via Gitea's "Modify multiple files" contents endpoint, which is far simpler
// than GitHub's blob/tree/commit/ref dance.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import { resolve } from "path";
import {
  GiteaClient,
  type GiteaChangeFileOperation,
} from "../providers/gitea/client";
import { validatePathWithinRepo } from "./path-validation";

const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const BRANCH_NAME = process.env.BRANCH_NAME;
const BASE_BRANCH = process.env.BASE_BRANCH;
const REPO_DIR = process.env.REPO_DIR || process.cwd();
const GITEA_API_URL = process.env.GITEA_API_URL;

if (!REPO_OWNER || !REPO_NAME || !BRANCH_NAME) {
  console.error(
    "Error: REPO_OWNER, REPO_NAME, and BRANCH_NAME environment variables are required",
  );
  process.exit(1);
}

function getClient(): GiteaClient {
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITEA_TOKEN environment variable is required");
  }
  return new GiteaClient(token, GITEA_API_URL);
}

/**
 * Resolve whether we commit onto the existing target branch, or create it from
 * the base branch on this commit. Returns the branch to read existing file
 * SHAs from, plus the change-files branch/new_branch fields.
 */
async function resolveBranchTarget(client: GiteaClient) {
  const owner = REPO_OWNER as string;
  const repo = REPO_NAME as string;
  const branch = BRANCH_NAME as string;
  try {
    await client.getBranch(owner, repo, branch);
    return {
      readRef: branch,
      branch,
      newBranch: undefined as string | undefined,
    };
  } catch (error) {
    if ((error as { status?: number }).status === 404 && BASE_BRANCH) {
      // Target branch does not exist yet — create it from the base branch.
      return { readRef: BASE_BRANCH, branch: BASE_BRANCH, newBranch: branch };
    }
    throw error;
  }
}

const server = new McpServer({
  name: "Gitea File Operations Server",
  version: "0.0.1",
});

server.tool(
  "commit_files",
  "Commit one or more files to a repository in a single commit (creates or updates files)",
  {
    files: z
      .array(z.string())
      .describe(
        'Array of file paths relative to repository root (e.g. ["src/main.js", "README.md"]). All files must exist locally.',
      ),
    message: z.string().describe("Commit message"),
  },
  async ({ files, message }) => {
    try {
      const client = getClient();
      const owner = REPO_OWNER as string;
      const repo = REPO_NAME as string;

      const validatedFiles = await Promise.all(
        files.map(async (filePath) => {
          const fullPath = await validatePathWithinRepo(filePath, REPO_DIR);
          const resolvedRepoDir = resolve(REPO_DIR);
          const relativePath = resolve(resolvedRepoDir, filePath).slice(
            resolvedRepoDir.length + 1,
          );
          return { fullPath, relativePath };
        }),
      );

      const { readRef, branch, newBranch } = await resolveBranchTarget(client);

      const operations: GiteaChangeFileOperation[] = await Promise.all(
        validatedFiles.map(async ({ fullPath, relativePath }) => {
          const content = (await readFile(fullPath)).toString("base64");
          // Gitea distinguishes create vs update; update requires the blob sha.
          const existingSha = await client.getFileSha(
            owner,
            repo,
            relativePath,
            readRef,
          );
          return existingSha
            ? {
                operation: "update" as const,
                path: relativePath,
                content,
                sha: existingSha,
              }
            : { operation: "create" as const, path: relativePath, content };
        }),
      );

      const result = await client.changeFiles(owner, repo, {
        files: operations,
        message,
        branch,
        new_branch: newBranch,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                commit: {
                  sha: result.commit?.sha,
                  html_url: result.commit?.html_url,
                },
                files: validatedFiles.map(({ relativePath }) => ({
                  path: relativePath,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

server.tool(
  "delete_files",
  "Delete one or more files from a repository in a single commit",
  {
    paths: z
      .array(z.string())
      .describe(
        'Array of file paths to delete relative to repository root (e.g. ["src/old-file.js", "docs/deprecated.md"])',
      ),
    message: z.string().describe("Commit message"),
  },
  async ({ paths, message }) => {
    try {
      const client = getClient();
      const owner = REPO_OWNER as string;
      const repo = REPO_NAME as string;

      const cwd = process.cwd();
      const processedPaths = paths.map((filePath) => {
        if (filePath.startsWith("/")) {
          if (filePath.startsWith(cwd)) {
            return filePath.slice(cwd.length + 1);
          }
          throw new Error(
            `Path '${filePath}' must be relative to repository root or within current working directory`,
          );
        }
        return filePath;
      });

      const { readRef, branch, newBranch } = await resolveBranchTarget(client);

      const operations: GiteaChangeFileOperation[] = await Promise.all(
        processedPaths.map(async (path) => {
          const sha = await client.getFileSha(owner, repo, path, readRef);
          if (!sha) {
            throw new Error(
              `Cannot delete '${path}': file not found on branch`,
            );
          }
          return { operation: "delete" as const, path, sha };
        }),
      );

      const result = await client.changeFiles(owner, repo, {
        files: operations,
        message,
        branch,
        new_branch: newBranch,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                commit: {
                  sha: result.commit?.sha,
                  html_url: result.commit?.html_url,
                },
                deleted: processedPaths,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);
