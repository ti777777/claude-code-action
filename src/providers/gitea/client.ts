/**
 * Minimal Gitea REST API client (Swagger `/api/v1`).
 *
 * Gitea does not expose a GraphQL API, so unlike the GitHub provider (which
 * fetches a whole issue/PR graph in one query) this client makes a handful of
 * small REST calls and the fetcher stitches the results into the shared
 * FetchDataResult shape.
 *
 * Auth uses the `Authorization: token <token>` scheme accepted by Gitea for
 * personal access tokens and Gitea Actions run tokens alike.
 */
import { getGiteaApiUrl } from "../config";
import { retryWithBackoff } from "../../utils/retry";

export type GiteaUser = {
  id: number;
  login: string;
  full_name?: string;
  email?: string;
};

export type GiteaLabel = {
  id: number;
  name: string;
};

export type GiteaComment = {
  id: number;
  body: string;
  user: GiteaUser;
  created_at: string;
  updated_at?: string;
  html_url?: string;
};

export type GiteaIssue = {
  number: number;
  title: string;
  body: string;
  user: GiteaUser;
  labels?: GiteaLabel[];
  state: string;
  created_at: string;
  updated_at?: string;
};

export type GiteaBranchRef = {
  ref?: string;
  sha?: string;
  repo?: {
    full_name?: string;
    name?: string;
    owner?: { login?: string } | null;
  } | null;
};

export type GiteaPullRequest = {
  number: number;
  title: string;
  body: string;
  user: GiteaUser;
  labels?: GiteaLabel[];
  state: string;
  additions?: number;
  deletions?: number;
  merged?: boolean;
  created_at: string;
  updated_at?: string;
  head: GiteaBranchRef;
  base: GiteaBranchRef;
};

export type GiteaChangedFile = {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
};

export type GiteaCommit = {
  sha: string;
  commit?: { message?: string; author?: { name?: string; email?: string } };
};

export type GiteaReview = {
  id: number;
  user: GiteaUser;
  body: string;
  state: string;
  submitted_at: string;
};

export type GiteaReviewComment = {
  id: number;
  body: string;
  user: GiteaUser;
  path: string;
  line?: number | null;
  created_at: string;
  updated_at?: string;
};

export type GiteaFileContents = {
  type: string;
  path: string;
  sha?: string;
  content?: string;
  encoding?: string;
};

/** A file object, or an array of entries for a directory listing. */
export type GiteaContents = GiteaFileContents | GiteaFileContents[];

export type GiteaChangeFileOperation = {
  operation: "create" | "update" | "delete";
  path: string;
  content?: string;
  sha?: string;
};

export type GiteaChangeFilesOptions = {
  files: GiteaChangeFileOperation[];
  message: string;
  branch?: string;
  new_branch?: string;
  author?: { name?: string; email?: string };
  committer?: { name?: string; email?: string };
};

export type GiteaFilesResponse = {
  commit?: {
    sha?: string;
    html_url?: string;
    message?: string;
  };
};

/** Encode a repo-relative path for the contents API, preserving slashes. */
function encodeGiteaPath(filepath: string): string {
  return filepath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export class GiteaClient {
  private readonly apiUrl: string;
  private readonly token: string;

  constructor(token: string, apiUrl: string = getGiteaApiUrl()) {
    this.token = token;
    this.apiUrl = apiUrl.replace(/\/+$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `token ${this.token}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    return retryWithBackoff(
      async () => {
        const response = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const error = new Error(
            `Gitea API ${method} ${path} failed: ${response.status} ${response.statusText}${
              text ? ` - ${text}` : ""
            }`,
          );
          (error as { status?: number }).status = response.status;
          throw error;
        }

        if (response.status === 204) {
          return undefined as T;
        }
        return (await response.json()) as T;
      },
      {
        initialDelayMs: 1000,
        // Only retry transient failures: network errors (no status) and
        // 429/5xx. Retrying a 4xx (404, 403, 422) would just waste backoff.
        shouldRetry: (error) => {
          const status = (error as { status?: number }).status;
          return status === undefined || status === 429 || status >= 500;
        },
      },
    );
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  // --- Repository ---------------------------------------------------------

  getRepo(owner: string, repo: string): Promise<{ default_branch: string }> {
    return this.get(`/repos/${owner}/${repo}`);
  }

  getBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<{ commit: { id: string } }> {
    return this.get(
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    );
  }

  // --- Issues -------------------------------------------------------------

  getIssue(owner: string, repo: string, index: number): Promise<GiteaIssue> {
    return this.get(`/repos/${owner}/${repo}/issues/${index}`);
  }

  listIssueComments(
    owner: string,
    repo: string,
    index: number,
  ): Promise<GiteaComment[]> {
    return this.get(`/repos/${owner}/${repo}/issues/${index}/comments`);
  }

  createIssueComment(
    owner: string,
    repo: string,
    index: number,
    body: string,
  ): Promise<GiteaComment> {
    return this.post(`/repos/${owner}/${repo}/issues/${index}/comments`, {
      body,
    });
  }

  getIssueComment(
    owner: string,
    repo: string,
    commentId: number,
  ): Promise<GiteaComment> {
    return this.get(`/repos/${owner}/${repo}/issues/comments/${commentId}`);
  }

  updateIssueComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string,
  ): Promise<GiteaComment> {
    return this.patch(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
      body,
    });
  }

  // --- Pull requests ------------------------------------------------------

  getPullRequest(
    owner: string,
    repo: string,
    index: number,
  ): Promise<GiteaPullRequest> {
    return this.get(`/repos/${owner}/${repo}/pulls/${index}`);
  }

  listPullRequestFiles(
    owner: string,
    repo: string,
    index: number,
  ): Promise<GiteaChangedFile[]> {
    return this.get(`/repos/${owner}/${repo}/pulls/${index}/files`);
  }

  listPullRequestCommits(
    owner: string,
    repo: string,
    index: number,
  ): Promise<GiteaCommit[]> {
    return this.get(`/repos/${owner}/${repo}/pulls/${index}/commits`);
  }

  listPullRequestReviews(
    owner: string,
    repo: string,
    index: number,
  ): Promise<GiteaReview[]> {
    return this.get(`/repos/${owner}/${repo}/pulls/${index}/reviews`);
  }

  listReviewComments(
    owner: string,
    repo: string,
    index: number,
    reviewId: number,
  ): Promise<GiteaReviewComment[]> {
    return this.get(
      `/repos/${owner}/${repo}/pulls/${index}/reviews/${reviewId}/comments`,
    );
  }

  // --- Contents (file operations) ----------------------------------------

  /**
   * Read a path's metadata/content. Returns the raw Gitea response (a file
   * object with base64 `content` and `sha`, or an array for directories).
   * Throws with status 404 when the path does not exist on `ref`.
   */
  getContents(
    owner: string,
    repo: string,
    filepath: string,
    ref?: string,
  ): Promise<GiteaContents> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return this.get(
      `/repos/${owner}/${repo}/contents/${encodeGiteaPath(filepath)}${query}`,
    );
  }

  /** Look up a file's blob sha on a ref, or null if it does not exist. */
  async getFileSha(
    owner: string,
    repo: string,
    filepath: string,
    ref?: string,
  ): Promise<string | null> {
    try {
      const contents = await this.getContents(owner, repo, filepath, ref);
      return Array.isArray(contents) ? null : (contents.sha ?? null);
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Atomically create/update/delete multiple files in a single commit via
   * Gitea's "Modify multiple files" endpoint. Set `new_branch` to create the
   * target branch from `branch` on the first commit.
   */
  changeFiles(
    owner: string,
    repo: string,
    body: GiteaChangeFilesOptions,
  ): Promise<GiteaFilesResponse> {
    return this.post(`/repos/${owner}/${repo}/contents`, body);
  }

  // --- Users & permissions ------------------------------------------------

  getUser(username: string): Promise<GiteaUser> {
    return this.get(`/users/${encodeURIComponent(username)}`);
  }

  getCollaboratorPermission(
    owner: string,
    repo: string,
    username: string,
  ): Promise<{ permission: string }> {
    return this.get(
      `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(
        username,
      )}/permission`,
    );
  }
}
