/**
 * Gitea tracking-comment operations — the Gitea equivalents of
 * createInitialComment (src/github/operations/comments/create-initial.ts) and
 * updateCommentLink (src/entrypoints/update-comment-link.ts).
 *
 * Gitea has no separate review-comment id namespace to worry about here: the
 * tracking comment is always a regular issue/PR comment, which keeps this much
 * simpler than the GitHub path.
 */
import { appendFileSync } from "fs";
import * as fs from "fs/promises";
import { $ } from "bun";
import {
  createJobRunLink,
  createCommentBody,
} from "../../github/operations/comments/common";
import {
  updateCommentBody,
  type CommentUpdateInput,
} from "../../github/operations/comment-logic";
import type { ParsedGitHubContext } from "../../github/context";
import type { UpdateTrackingCommentParams } from "../types";
import type { GiteaClient } from "./client";

export async function createGiteaInitialComment(
  client: GiteaClient,
  context: ParsedGitHubContext,
): Promise<{ id: number }> {
  const { owner, repo } = context.repository;
  const jobRunLink = createJobRunLink(owner, repo, context.runId);
  const initialBody = createCommentBody(jobRunLink);

  const comment = await client.createIssueComment(
    owner,
    repo,
    context.entityNumber,
    initialBody,
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `claude_comment_id=${comment.id}\n`);
  }
  console.log(`✅ Created initial Gitea comment with ID: ${comment.id}`);
  return { id: comment.id };
}

async function computeBranchLinks(
  serverUrl: string,
  owner: string,
  repo: string,
  claudeBranch: string | undefined,
  baseBranch: string,
): Promise<{ branchLink: string; prLink: string }> {
  if (!claudeBranch) {
    return { branchLink: "", prLink: "" };
  }

  // Only surface branch / PR links if Claude actually pushed the branch.
  let branchExists = false;
  try {
    await $`git ls-remote --exit-code origin refs/heads/${claudeBranch}`.quiet();
    branchExists = true;
  } catch {
    branchExists = false;
  }
  if (!branchExists) {
    return { branchLink: "", prLink: "" };
  }

  const branchLink = `\n[View branch](${serverUrl}/${owner}/${repo}/src/branch/${claudeBranch})`;
  const prUrl = `${serverUrl}/${owner}/${repo}/compare/${baseBranch}...${claudeBranch}`;
  const prLink = `\n[Create a PR](${prUrl})`;
  return { branchLink, prLink };
}

export async function updateGiteaTrackingComment(
  client: GiteaClient,
  serverUrl: string,
  params: UpdateTrackingCommentParams,
): Promise<void> {
  const {
    commentId,
    claudeBranch,
    baseBranch,
    triggerUsername,
    context,
    claudeSuccess,
    outputFile,
    prepareSuccess,
    prepareError,
  } = params;
  const { owner, repo } = context.repository;

  const jobUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  const comment = await client.getIssueComment(owner, repo, commentId);
  const currentBody = comment.body ?? "";

  const { branchLink, prLink } = await computeBranchLinks(
    serverUrl,
    owner,
    repo,
    claudeBranch,
    baseBranch,
  );

  // Parse execution details / failure state, matching update-comment-link.ts.
  let executionDetails: {
    total_cost_usd?: number;
    duration_ms?: number;
    duration_api_ms?: number;
  } | null = null;
  let actionFailed = false;
  let errorDetails: string | undefined;

  if (!prepareSuccess && prepareError) {
    actionFailed = true;
    errorDetails = prepareError;
  } else {
    try {
      if (outputFile) {
        const fileContent = await fs.readFile(outputFile, "utf8");
        const outputData = JSON.parse(fileContent);
        if (Array.isArray(outputData) && outputData.length > 0) {
          const lastElement = outputData[outputData.length - 1];
          if (
            lastElement.type === "result" &&
            "total_cost_usd" in lastElement &&
            "duration_ms" in lastElement
          ) {
            executionDetails = {
              total_cost_usd: lastElement.total_cost_usd,
              duration_ms: lastElement.duration_ms,
              duration_api_ms: lastElement.duration_api_ms,
            };
          }
        }
      }
      actionFailed = !claudeSuccess;
    } catch (error) {
      console.error("Error reading output file:", error);
      actionFailed = !claudeSuccess;
    }
  }

  const commentInput: CommentUpdateInput = {
    currentBody,
    actionFailed,
    executionDetails,
    jobUrl,
    branchLink,
    prLink,
    branchName: branchLink ? claudeBranch : undefined,
    triggerUsername,
    errorDetails,
  };

  const updatedBody = updateCommentBody(commentInput);

  await client.updateIssueComment(owner, repo, commentId, updatedBody);
  console.log(`✅ Updated Gitea comment ${commentId} with job link`);
}
