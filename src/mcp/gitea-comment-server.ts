#!/usr/bin/env node
// Gitea Comment MCP Server — the Gitea counterpart of github-comment-server.ts.
// Exposes a single tool to update Claude's tracking comment via Gitea's REST API.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GiteaClient } from "../providers/gitea/client";
import { sanitizeContent } from "../github/utils/sanitizer";

const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const GITEA_API_URL = process.env.GITEA_API_URL;

if (!REPO_OWNER || !REPO_NAME) {
  console.error(
    "Error: REPO_OWNER and REPO_NAME environment variables are required",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "Gitea Comment Server",
  version: "0.0.1",
});

server.tool(
  "update_claude_comment",
  "Update the Claude comment with progress and results (Gitea issue/PR comment)",
  {
    body: z.string().describe("The updated comment content"),
  },
  async ({ body }) => {
    try {
      const giteaToken = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN;
      const claudeCommentId = process.env.CLAUDE_COMMENT_ID;

      if (!giteaToken) {
        throw new Error("GITEA_TOKEN environment variable is required");
      }
      if (!claudeCommentId) {
        throw new Error("CLAUDE_COMMENT_ID environment variable is required");
      }

      const client = new GiteaClient(giteaToken, GITEA_API_URL);
      const sanitizedBody = sanitizeContent(body);

      const result = await client.updateIssueComment(
        REPO_OWNER,
        REPO_NAME,
        parseInt(claudeCommentId, 10),
        sanitizedBody,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: result.id,
                html_url: result.html_url,
                updated_at: result.updated_at,
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
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
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
