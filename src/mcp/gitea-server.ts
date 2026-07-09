#!/usr/bin/env node
// General-purpose Gitea MCP Server — exposes a focused set of Gitea REST API
// operations to Claude, mirroring how the GitHub provider offers the upstream
// github-mcp-server. Opt-in via `mcp__gitea__*` allowed tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GiteaClient, type GiteaFileContents } from "../providers/gitea/client";
import { sanitizeContent } from "../github/utils/sanitizer";

const DEFAULT_OWNER = process.env.REPO_OWNER;
const DEFAULT_REPO = process.env.REPO_NAME;
const GITEA_API_URL = process.env.GITEA_API_URL;

function getClient(): GiteaClient {
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITEA_TOKEN environment variable is required");
  }
  return new GiteaClient(token, GITEA_API_URL);
}

function resolveRepo(owner?: string, repo?: string): [string, string] {
  const resolvedOwner = owner || DEFAULT_OWNER;
  const resolvedRepo = repo || DEFAULT_REPO;
  if (!resolvedOwner || !resolvedRepo) {
    throw new Error(
      "owner and repo are required (set REPO_OWNER/REPO_NAME or pass them explicitly)",
    );
  }
  return [resolvedOwner, resolvedRepo];
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${errorMessage}` }],
    error: errorMessage,
    isError: true,
  };
}

const server = new McpServer({ name: "Gitea Server", version: "0.0.1" });

const repoArgs = {
  owner: z
    .string()
    .optional()
    .describe("Repository owner (defaults to the current repo's owner)"),
  repo: z
    .string()
    .optional()
    .describe("Repository name (defaults to the current repo)"),
};

server.tool(
  "get_issue",
  "Get a Gitea issue by number",
  { ...repoArgs, index: z.number().describe("Issue number") },
  async ({ owner, repo, index }) => {
    try {
      const [o, r] = resolveRepo(owner, repo);
      return ok(await getClient().getIssue(o, r, index));
    } catch (error) {
      return fail(error);
    }
  },
);

server.tool(
  "get_pull_request",
  "Get a Gitea pull request by number",
  { ...repoArgs, index: z.number().describe("Pull request number") },
  async ({ owner, repo, index }) => {
    try {
      const [o, r] = resolveRepo(owner, repo);
      return ok(await getClient().getPullRequest(o, r, index));
    } catch (error) {
      return fail(error);
    }
  },
);

server.tool(
  "list_issue_comments",
  "List comments on a Gitea issue or pull request",
  { ...repoArgs, index: z.number().describe("Issue or PR number") },
  async ({ owner, repo, index }) => {
    try {
      const [o, r] = resolveRepo(owner, repo);
      return ok(await getClient().listIssueComments(o, r, index));
    } catch (error) {
      return fail(error);
    }
  },
);

server.tool(
  "create_issue_comment",
  "Create a comment on a Gitea issue or pull request",
  {
    ...repoArgs,
    index: z.number().describe("Issue or PR number"),
    body: z.string().describe("Comment body (markdown)"),
  },
  async ({ owner, repo, index, body }) => {
    try {
      const [o, r] = resolveRepo(owner, repo);
      const created = await getClient().createIssueComment(
        o,
        r,
        index,
        sanitizeContent(body),
      );
      return ok(created);
    } catch (error) {
      return fail(error);
    }
  },
);

server.tool(
  "get_file_contents",
  "Read a file's contents from a Gitea repository",
  {
    ...repoArgs,
    path: z.string().describe("File path relative to the repository root"),
    ref: z
      .string()
      .optional()
      .describe("Branch, tag, or commit sha (defaults to the default branch)"),
  },
  async ({ owner, repo, path, ref }) => {
    try {
      const [o, r] = resolveRepo(owner, repo);
      const contents = await getClient().getContents(o, r, path, ref);
      if (Array.isArray(contents)) {
        return ok(contents);
      }
      const file = contents as GiteaFileContents;
      const decoded =
        file.encoding === "base64" && file.content
          ? Buffer.from(file.content, "base64").toString("utf-8")
          : file.content;
      return ok({ path: file.path, sha: file.sha, content: decoded });
    } catch (error) {
      return fail(error);
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
