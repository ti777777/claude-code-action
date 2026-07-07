/**
 * Gitea branch setup — the Gitea equivalent of
 * src/github/operations/branch.ts. The git-CLI parts (fetch/checkout) are
 * platform-neutral and identical; only the "look up the default branch / source
 * SHA" calls go through the Gitea REST client instead of Octokit.
 */
import { $ } from "bun";
import { execFileSync } from "child_process";
import type { ParsedGitHubContext } from "../../github/context";
import type { GitHubPullRequest } from "../../github/types";
import type { FetchDataResult } from "../../github/data/fetcher";
import type { BranchInfo } from "../../github/operations/branch";
import { validateBranchName } from "../../github/operations/branch";
import { generateBranchName } from "../../utils/branch-template";
import type { GiteaClient } from "./client";

function extractFirstLabel(githubData: FetchDataResult): string | undefined {
  const labels = githubData.contextData.labels?.nodes;
  return labels && labels.length > 0 ? labels[0]?.name : undefined;
}

function execGit(args: string[]): void {
  execFileSync("git", args, { stdio: "inherit", env: process.env });
}

export async function setupGiteaBranch(
  client: GiteaClient,
  githubData: FetchDataResult,
  context: ParsedGitHubContext,
): Promise<BranchInfo> {
  const { owner, repo } = context.repository;
  const entityNumber = context.entityNumber;
  const { baseBranch, branchPrefix, branchNameTemplate } = context.inputs;
  const isPR = context.isPR;

  if (isPR) {
    const prData = githubData.contextData as GitHubPullRequest;
    const prState = prData.state;

    if (prState === "CLOSED" || prState === "MERGED") {
      console.log(
        `PR #${entityNumber} is ${prState}, creating new branch from source...`,
      );
      // Fall through to create a new branch like we do for issues.
    } else {
      console.log("This is an open PR, checking out PR branch...");
      const branchName = prData.headRefName;
      const commitCount = prData.commits.totalCount;
      const fetchDepth = Math.max(commitCount, 20);

      validateBranchName(branchName);

      if (prData.isCrossRepository) {
        console.log(
          `PR #${entityNumber} is from a fork, fetching via refs/pull/${entityNumber}/head...`,
        );
        execGit([
          "fetch",
          "origin",
          `--depth=${fetchDepth}`,
          `pull/${entityNumber}/head:${branchName}`,
        ]);
      } else {
        execGit(["fetch", "origin", `--depth=${fetchDepth}`, branchName]);
      }
      execGit(["checkout", branchName, "--"]);

      const prBaseBranch = prData.baseRefName;
      validateBranchName(prBaseBranch);

      return {
        baseBranch: prBaseBranch,
        currentBranch: branchName,
      };
    }
  }

  // Determine source branch.
  let sourceBranch: string;
  if (baseBranch) {
    sourceBranch = baseBranch;
  } else {
    const repoData = await client.getRepo(owner, repo);
    sourceBranch = repoData.default_branch;
  }

  const entityType = isPR ? "pr" : "issue";

  try {
    const sourceBranchData = await client.getBranch(owner, repo, sourceBranch);
    const sourceSHA = sourceBranchData.commit.id;
    console.log(`Source branch SHA: ${sourceSHA}`);

    const firstLabel = extractFirstLabel(githubData);
    const title = githubData.contextData.title;

    let newBranch = generateBranchName(
      branchNameTemplate,
      branchPrefix,
      entityType,
      entityNumber,
      sourceSHA,
      firstLabel,
      title,
    );

    try {
      await $`git ls-remote --exit-code origin refs/heads/${newBranch}`.quiet();
      console.log(
        `Branch '${newBranch}' already exists, falling back to default format`,
      );
      newBranch = generateBranchName(
        undefined,
        branchPrefix,
        entityType,
        entityNumber,
        sourceSHA,
        firstLabel,
        title,
      );
    } catch {
      // Branch doesn't exist, continue with generated name.
    }

    if (context.inputs.useCommitSigning) {
      console.log(
        `Branch name generated: ${newBranch} (will be created by file ops server on first commit)`,
      );
      validateBranchName(sourceBranch);
      execGit(["fetch", "origin", sourceBranch, "--depth=1"]);
      execGit(["checkout", sourceBranch, "--"]);

      return {
        baseBranch: sourceBranch,
        claudeBranch: newBranch,
        currentBranch: sourceBranch,
      };
    }

    console.log(
      `Creating local branch ${newBranch} for ${entityType} #${entityNumber} from source branch: ${sourceBranch}...`,
    );
    validateBranchName(sourceBranch);
    validateBranchName(newBranch);
    execGit(["fetch", "origin", sourceBranch, "--depth=1"]);
    execGit(["checkout", sourceBranch, "--"]);
    execGit(["checkout", "-b", newBranch]);

    console.log(
      `Successfully created and checked out local branch: ${newBranch}`,
    );

    return {
      baseBranch: sourceBranch,
      claudeBranch: newBranch,
      currentBranch: newBranch,
    };
  } catch (error) {
    console.error("Error in branch setup:", error);
    process.exit(1);
  }
}
