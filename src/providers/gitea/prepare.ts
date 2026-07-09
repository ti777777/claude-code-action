/**
 * Gitea prepare phase — the Gitea analogue of src/modes/tag/index.ts and
 * src/modes/agent/index.ts. The prompt generation (createPrompt), tool parsing
 * and claude_args assembly are shared with the GitHub path; only the data
 * fetching, branch/comment operations and MCP wiring are Gitea-specific.
 */
import { mkdir, rm, writeFile } from "fs/promises";
import { isEntityContext, type GitHubContext } from "../../github/context";
import {
  extractTriggerTimestamp,
  extractOriginalTitle,
  extractOriginalBody,
} from "../../github/data/fetcher";
import { createPrompt } from "../../create-prompt";
import { parseAllowedTools } from "../../modes/agent/parse-tools";
import { setupSshSigning } from "../../github/operations/git-config";
import type { PrepareResult } from "../types";
import { GiteaClient } from "./client";
import { fetchGiteaData } from "./fetcher";
import { setupGiteaBranch } from "./branch";
import { createGiteaInitialComment } from "./comments";
import { configureGiteaGitAuth } from "./git-config";
import { prepareGiteaMcpConfig } from "./mcp";

type PrepareParams = {
  context: GitHubContext;
  token: string;
  apiUrl: string;
  serverUrl: string;
};

async function configureAuth(
  token: string,
  serverUrl: string,
  context: GitHubContext,
) {
  const useSshSigning = !!context.inputs.sshSigningKey;
  const useApiCommitSigning = context.inputs.useCommitSigning && !useSshSigning;

  const user = {
    login: context.inputs.botName,
    id: parseInt(context.inputs.botId),
  };

  if (useSshSigning) {
    await setupSshSigning(context.inputs.sshSigningKey);
    await configureGiteaGitAuth(token, serverUrl, context, user);
  } else if (!useApiCommitSigning) {
    await configureGiteaGitAuth(token, serverUrl, context, user);
  }
}

export async function prepareGiteaTagMode({
  context,
  token,
  apiUrl,
  serverUrl,
}: PrepareParams): Promise<PrepareResult> {
  if (!isEntityContext(context)) {
    throw new Error("Tag mode requires entity context");
  }

  const client = new GiteaClient(token, apiUrl);

  // Create the tracking comment first so the user sees immediate feedback.
  const { id: commentId } = await createGiteaInitialComment(client, context);

  const triggerTime = extractTriggerTimestamp(context);
  const originalTitle = extractOriginalTitle(context);
  const originalBody = extractOriginalBody(context);

  const giteaData = await fetchGiteaData({
    client,
    repository: `${context.repository.owner}/${context.repository.repo}`,
    prNumber: context.entityNumber.toString(),
    isPR: context.isPR,
    triggerUsername: context.actor,
    triggerTime,
    originalTitle,
    originalBody,
    includeCommentsByActor: context.inputs.includeCommentsByActor,
    excludeCommentsByActor: context.inputs.excludeCommentsByActor,
  });

  const branchInfo = await setupGiteaBranch(client, giteaData, context);

  try {
    await configureAuth(token, serverUrl, context);
  } catch (error) {
    console.error("Failed to configure Gitea git authentication:", error);
    throw error;
  }

  await createPrompt(
    commentId,
    branchInfo.baseBranch,
    branchInfo.claudeBranch,
    giteaData,
    context,
  );

  const userClaudeArgs = process.env.CLAUDE_ARGS || "";
  const userAllowedMCPTools = parseAllowedTools(userClaudeArgs).filter(
    (tool) =>
      tool.startsWith("mcp__github_") || tool.startsWith("mcp__gitea__"),
  );

  const gitPushWrapper = `${process.env.GITHUB_ACTION_PATH}/scripts/git-push.sh`;
  const useApiCommitSigning =
    context.inputs.useCommitSigning && !context.inputs.sshSigningKey;

  // Same base tool set as the GitHub tag mode, minus the CI tools (Gitea's
  // Actions API is not wired up as an MCP server yet).
  const tagModeTools = [
    "Glob",
    "Grep",
    "LS",
    "Read",
    "mcp__github_comment__update_claude_comment",
    ...userAllowedMCPTools,
  ];

  if (!useApiCommitSigning) {
    tagModeTools.push(
      "Bash(git add:*)",
      "Bash(git commit:*)",
      `Bash(${gitPushWrapper}:*)`,
      "Bash(git rm:*)",
    );
  } else {
    tagModeTools.push(
      "mcp__github_file_ops__commit_files",
      "mcp__github_file_ops__delete_files",
    );
  }

  const mcpConfig = prepareGiteaMcpConfig({
    token,
    apiUrl,
    serverUrl,
    owner: context.repository.owner,
    repo: context.repository.repo,
    branch: branchInfo.claudeBranch || branchInfo.currentBranch,
    baseBranch: branchInfo.baseBranch,
    claudeCommentId: commentId.toString(),
    allowedTools: Array.from(new Set(tagModeTools)),
    mode: "tag",
    context,
  });

  const escapedConfig = mcpConfig.replace(/'/g, "'\\''");
  let claudeArgs = `--mcp-config '${escapedConfig}'`;
  claudeArgs += ` --permission-mode acceptEdits --allowedTools "${tagModeTools.join(",")}"`;
  if (userClaudeArgs) {
    claudeArgs += ` ${userClaudeArgs}`;
  }

  return {
    commentId,
    branchInfo,
    mcpConfig,
    claudeArgs: claudeArgs.trim(),
  };
}

export async function prepareGiteaAgentMode({
  context,
  token,
  apiUrl,
  serverUrl,
}: PrepareParams): Promise<PrepareResult> {
  try {
    await configureAuth(token, serverUrl, context);
  } catch (error) {
    console.error("Failed to configure Gitea git authentication:", error);
    // Continue anyway - git operations may still work with default config.
  }

  const promptDir = `${process.env.RUNNER_TEMP || "/tmp"}/claude-prompts`;
  await rm(promptDir, { recursive: true, force: true });
  await mkdir(promptDir, { recursive: true });

  const promptContent =
    context.inputs.prompt ||
    `Repository: ${context.repository.owner}/${context.repository.repo}`;
  await writeFile(`${promptDir}/claude-prompt.txt`, promptContent);

  const userClaudeArgs = process.env.CLAUDE_ARGS || "";
  const allowedTools = parseAllowedTools(userClaudeArgs);

  const claudeBranch = process.env.CLAUDE_BRANCH || undefined;
  const defaultBranch = context.repository.default_branch || "main";
  const baseBranch = context.inputs.baseBranch || defaultBranch;
  const currentBranch =
    claudeBranch ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    defaultBranch;

  const mcpConfig = prepareGiteaMcpConfig({
    token,
    apiUrl,
    serverUrl,
    owner: context.repository.owner,
    repo: context.repository.repo,
    branch: currentBranch,
    baseBranch,
    claudeCommentId: undefined,
    allowedTools,
    mode: "agent",
    context,
  });

  let claudeArgs = "";
  const parsedConfig = JSON.parse(mcpConfig);
  if (
    parsedConfig.mcpServers &&
    Object.keys(parsedConfig.mcpServers).length > 0
  ) {
    const escapedConfig = mcpConfig.replace(/'/g, "'\\''");
    claudeArgs = `--mcp-config '${escapedConfig}'`;
  }
  claudeArgs = `${claudeArgs} ${userClaudeArgs}`.trim();

  return {
    commentId: undefined,
    branchInfo: {
      baseBranch,
      currentBranch: baseBranch,
      claudeBranch,
    },
    mcpConfig,
    claudeArgs,
  };
}
