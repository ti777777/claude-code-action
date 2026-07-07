/**
 * Builds the MCP server configuration for the Gitea provider.
 *
 * The tracking-comment and file-ops servers are registered under the SAME keys
 * the GitHub provider uses (`github_comment`, `github_file_ops`). This is
 * deliberate: the shared prompt and the tag-mode allowlist reference tool names
 * like `mcp__github_comment__update_claude_comment`, so keeping the keys stable
 * lets the exact same prompt drive either platform. Only the server script
 * behind each key differs — here it talks to Gitea's REST API.
 */
import * as core from "@actions/core";
import type { GitHubContext } from "../../github/context";
import { isEntityContext } from "../../github/context";
import type { AutoDetectedMode } from "../../modes/detector";

type PrepareGiteaConfigParams = {
  token: string;
  apiUrl: string;
  serverUrl: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  claudeCommentId?: string;
  allowedTools: string[];
  mode: AutoDetectedMode;
  context: GitHubContext;
};

export function prepareGiteaMcpConfig(
  params: PrepareGiteaConfigParams,
): string {
  const {
    token,
    apiUrl,
    serverUrl,
    owner,
    repo,
    branch,
    baseBranch,
    claudeCommentId,
    allowedTools,
    mode,
    context,
  } = params;

  try {
    const isAgentMode = mode === "agent";
    const actionPath = process.env.GITHUB_ACTION_PATH;

    const commonEnv = {
      GITEA_TOKEN: token,
      GITEA_API_URL: apiUrl,
      GITEA_SERVER_URL: serverUrl,
      REPO_OWNER: owner,
      REPO_NAME: repo,
    };

    const baseMcpConfig: { mcpServers: Record<string, unknown> } = {
      mcpServers: {},
    };

    const hasCommentTools = allowedTools.some((tool) =>
      tool.startsWith("mcp__github_comment__"),
    );
    const shouldIncludeCommentServer = !isAgentMode || hasCommentTools;

    if (shouldIncludeCommentServer) {
      baseMcpConfig.mcpServers.github_comment = {
        command: "bun",
        args: ["run", `${actionPath}/src/mcp/gitea-comment-server.ts`],
        env: {
          ...commonEnv,
          ...(claudeCommentId && { CLAUDE_COMMENT_ID: claudeCommentId }),
          GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "",
        },
      };
    }

    if (context.inputs.useCommitSigning) {
      baseMcpConfig.mcpServers.github_file_ops = {
        command: "bun",
        args: ["run", `${actionPath}/src/mcp/gitea-file-ops-server.ts`],
        env: {
          ...commonEnv,
          BRANCH_NAME: branch,
          BASE_BRANCH: baseBranch,
          REPO_DIR: process.env.GITHUB_WORKSPACE || process.cwd(),
          GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "",
        },
      };
    }

    // General-purpose Gitea API server, opt-in via `mcp__gitea__*` allowed tools.
    const hasGiteaTools = allowedTools.some((tool) =>
      tool.startsWith("mcp__gitea__"),
    );
    if (hasGiteaTools) {
      baseMcpConfig.mcpServers.gitea = {
        command: "bun",
        args: ["run", `${actionPath}/src/mcp/gitea-server.ts`],
        env: {
          ...commonEnv,
          ...(isEntityContext(context) && {
            ENTITY_NUMBER: context.entityNumber.toString(),
            IS_PR: context.isPR ? "true" : "false",
          }),
        },
      };
    }

    return JSON.stringify(baseMcpConfig, null, 2);
  } catch (error) {
    core.setFailed(`Install Gitea MCP server failed with error: ${error}`);
    process.exit(1);
  }
}
