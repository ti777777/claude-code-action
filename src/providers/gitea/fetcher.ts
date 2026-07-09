/**
 * Fetches issue / pull-request data from Gitea's REST API and maps it into the
 * platform-neutral {@link FetchDataResult} shape consumed by the prompt
 * formatter. The mapping mirrors what the GitHub GraphQL fetcher produces so
 * downstream prompt generation is provider-agnostic.
 */
import { execFileSync } from "child_process";
import {
  filterCommentsByActor,
  filterCommentsToTriggerTime,
  filterReviewsToTriggerTime,
  isBodySafeToUse,
  type FetchDataResult,
  type GitHubFileWithSHA,
} from "../../github/data/fetcher";
import type {
  GitHubComment,
  GitHubFile,
  GitHubIssue,
  GitHubPullRequest,
  GitHubReview,
  GitHubReviewComment,
} from "../../github/types";
import type {
  GiteaChangedFile,
  GiteaClient,
  GiteaComment,
  GiteaReviewComment,
} from "./client";

/** Gitea uses lower-case states ("open"/"closed"); GraphQL uses upper-case. */
function mapState(state: string, merged?: boolean): string {
  if (merged) return "MERGED";
  return (state || "").toUpperCase();
}

/** Gitea file status → GraphQL changeType. */
function mapChangeType(status: string): string {
  return (status || "").toUpperCase();
}

function mapComment(c: GiteaComment): GitHubComment {
  return {
    id: String(c.id),
    databaseId: String(c.id),
    body: c.body ?? "",
    author: { login: c.user?.login ?? "unknown" },
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    isMinimized: false,
  };
}

function mapReviewComment(c: GiteaReviewComment): GitHubReviewComment {
  return {
    id: String(c.id),
    databaseId: String(c.id),
    body: c.body ?? "",
    author: { login: c.user?.login ?? "unknown" },
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    isMinimized: false,
    path: c.path,
    line: c.line ?? null,
  };
}

function mapChangedFile(f: GiteaChangedFile): GitHubFile {
  return {
    path: f.filename,
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    changeType: mapChangeType(f.status),
  };
}

export type FetchGiteaDataParams = {
  client: GiteaClient;
  repository: string;
  prNumber: string;
  isPR: boolean;
  triggerUsername?: string;
  triggerTime?: string;
  originalTitle?: string;
  originalBody?: string | null;
  includeCommentsByActor?: string;
  excludeCommentsByActor?: string;
};

export async function fetchGiteaData({
  client,
  repository,
  prNumber,
  isPR,
  triggerUsername,
  triggerTime,
  originalTitle,
  originalBody,
  includeCommentsByActor,
  excludeCommentsByActor,
}: FetchGiteaDataParams): Promise<FetchDataResult> {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error("Invalid repository format. Expected 'owner/repo'.");
  }
  const index = parseInt(prNumber, 10);

  let contextData: GitHubIssue | GitHubPullRequest;
  let changedFiles: GitHubFile[] = [];
  let reviewData: { nodes: GitHubReview[] } | null = null;

  if (isPR) {
    const [pr, files, commits, reviews] = await Promise.all([
      client.getPullRequest(owner, repo, index),
      client.listPullRequestFiles(owner, repo, index).catch(() => []),
      client.listPullRequestCommits(owner, repo, index).catch(() => []),
      client.listPullRequestReviews(owner, repo, index).catch(() => []),
    ]);

    changedFiles = files.map(mapChangedFile);

    const headOwnerLogin = pr.head?.repo?.owner?.login;
    const headRepoName = pr.head?.repo?.name;
    const headFullName =
      pr.head?.repo?.full_name ??
      (headOwnerLogin && headRepoName
        ? `${headOwnerLogin}/${headRepoName}`
        : undefined);
    const isCrossRepository = headFullName
      ? headFullName !== `${owner}/${repo}`
      : false;

    // Review bodies + their inline comments (best-effort per-review fetch).
    const reviewNodes: GitHubReview[] = [];
    for (const review of reviews) {
      const comments = await client
        .listReviewComments(owner, repo, index, review.id)
        .catch(() => [] as GiteaReviewComment[]);
      reviewNodes.push({
        id: String(review.id),
        databaseId: String(review.id),
        author: { login: review.user?.login ?? "unknown" },
        body: review.body ?? "",
        state: (review.state || "").toUpperCase(),
        submittedAt: review.submitted_at,
        comments: { nodes: comments.map(mapReviewComment) },
      });
    }
    reviewData = { nodes: reviewNodes };

    const prComments = await client
      .listIssueComments(owner, repo, index)
      .catch(() => [] as GiteaComment[]);

    contextData = {
      title: pr.title,
      body: pr.body ?? "",
      author: { login: pr.user?.login ?? "unknown" },
      baseRefName: pr.base?.ref ?? "",
      headRefName: pr.head?.ref ?? "",
      headRefOid: pr.head?.sha ?? "",
      isCrossRepository,
      headRepository:
        headOwnerLogin && headRepoName
          ? { owner: { login: headOwnerLogin }, name: headRepoName }
          : null,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      state: mapState(pr.state, pr.merged),
      labels: { nodes: (pr.labels ?? []).map((l) => ({ name: l.name })) },
      commits: {
        totalCount: commits.length,
        nodes: commits.map((c) => ({
          commit: {
            oid: c.sha,
            message: c.commit?.message ?? "",
            author: {
              name: c.commit?.author?.name ?? "",
              email: c.commit?.author?.email ?? "",
            },
          },
        })),
      },
      files: { nodes: changedFiles },
      comments: { nodes: prComments.map(mapComment) },
      reviews: { nodes: reviewNodes },
    } satisfies GitHubPullRequest;
  } else {
    const [issue, issueComments] = await Promise.all([
      client.getIssue(owner, repo, index),
      client.listIssueComments(owner, repo, index).catch(() => []),
    ]);

    contextData = {
      title: issue.title,
      body: issue.body ?? "",
      author: { login: issue.user?.login ?? "unknown" },
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      state: mapState(issue.state),
      labels: { nodes: (issue.labels ?? []).map((l) => ({ name: l.name })) },
      comments: { nodes: issueComments.map(mapComment) },
    } satisfies GitHubIssue;
  }

  // Apply the same TOCTOU (trigger-time) + actor filtering as the GitHub path.
  let comments: GitHubComment[] = filterCommentsByActor(
    filterCommentsToTriggerTime(contextData.comments?.nodes ?? [], triggerTime),
    includeCommentsByActor,
    excludeCommentsByActor,
  );

  if (reviewData?.nodes) {
    reviewData.nodes = filterCommentsByActor(
      filterReviewsToTriggerTime(reviewData.nodes, triggerTime),
      includeCommentsByActor,
      excludeCommentsByActor,
    );
    reviewData.nodes.forEach((review) => {
      if (review.comments?.nodes) {
        review.comments.nodes = filterCommentsByActor(
          filterCommentsToTriggerTime(review.comments.nodes, triggerTime),
          includeCommentsByActor,
          excludeCommentsByActor,
        );
      }
    });
  }

  // Compute SHAs for changed files using the local checkout, matching the
  // GitHub fetcher (git hash-object on current file content).
  let changedFilesWithSHA: GitHubFileWithSHA[] = [];
  if (isPR && changedFiles.length > 0) {
    changedFilesWithSHA = changedFiles.map((file) => {
      if (file.changeType === "DELETED") {
        return { ...file, sha: "deleted" };
      }
      try {
        const sha = execFileSync("git", ["hash-object", file.path], {
          encoding: "utf-8",
        }).trim();
        return { ...file, sha };
      } catch (error) {
        console.warn(`Failed to compute SHA for ${file.path}:`, error);
        return { ...file, sha: "unknown" };
      }
    });
  }

  // TOCTOU protection for the main body, matching the GitHub fetcher.
  if (originalBody !== undefined) {
    contextData.body = originalBody ?? "";
  } else if (!isBodySafeToUse(contextData, triggerTime)) {
    console.warn(
      `Security: ${isPR ? "PR" : "Issue"} #${prNumber} body was edited after the trigger event. Excluding body content.`,
    );
    contextData.body = "";
  }

  if (originalTitle !== undefined) {
    contextData.title = originalTitle;
  }

  // Gitea comment images are served from the instance itself and are already
  // reachable by the model via their URLs, so there is nothing to pre-download.
  const imageUrlMap = new Map<string, string>();

  let triggerDisplayName: string | null | undefined;
  if (triggerUsername) {
    triggerDisplayName = await fetchGiteaUserDisplayName(
      client,
      triggerUsername,
    );
  }

  return {
    contextData,
    comments,
    changedFiles,
    changedFilesWithSHA,
    reviewData,
    imageUrlMap,
    triggerDisplayName,
  };
}

export async function fetchGiteaUserDisplayName(
  client: GiteaClient,
  login: string,
): Promise<string | null> {
  try {
    const user = await client.getUser(login);
    return user.full_name || null;
  } catch (error) {
    console.warn(
      `Failed to fetch Gitea user display name for ${login}:`,
      error,
    );
    return null;
  }
}
