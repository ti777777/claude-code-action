import { describe, expect, it } from "bun:test";
import { fetchGiteaData } from "../../src/providers/gitea/fetcher";
import type { GiteaClient } from "../../src/providers/gitea/client";

// A partial fake GiteaClient — only the methods the fetcher touches.
function fakeClient(overrides: Partial<Record<keyof GiteaClient, any>> = {}) {
  const base = {
    getIssue: async () => ({
      number: 7,
      title: "Issue title",
      body: "issue body",
      user: { id: 1, login: "alice" },
      labels: [{ id: 1, name: "bug" }],
      state: "open",
      created_at: "2024-01-01T00:00:00Z",
    }),
    listIssueComments: async () => [
      {
        id: 101,
        body: "a comment",
        user: { id: 2, login: "bob" },
        created_at: "2024-01-02T00:00:00Z",
      },
    ],
    getUser: async () => ({ id: 1, login: "alice", full_name: "Alice A." }),
    getPullRequest: async () => ({
      number: 9,
      title: "PR title",
      body: "pr body",
      user: { id: 1, login: "alice" },
      labels: [],
      state: "closed",
      merged: true,
      additions: 3,
      deletions: 1,
      created_at: "2024-01-01T00:00:00Z",
      head: {
        ref: "feature",
        sha: "abc123",
        repo: { name: "repo", owner: { login: "fork-owner" } },
      },
      base: { ref: "main", sha: "def456" },
    }),
    listPullRequestFiles: async () => [],
    listPullRequestCommits: async () => [{ sha: "abc123" }, { sha: "abc124" }],
    listPullRequestReviews: async () => [],
    listReviewComments: async () => [],
  };
  return { ...base, ...overrides } as unknown as GiteaClient;
}

describe("fetchGiteaData", () => {
  it("maps a Gitea issue into the shared FetchDataResult shape", async () => {
    const result = await fetchGiteaData({
      client: fakeClient(),
      repository: "owner/repo",
      prNumber: "7",
      isPR: false,
      triggerUsername: "alice",
    });

    expect(result.contextData.title).toBe("Issue title");
    expect(result.contextData.state).toBe("OPEN");
    expect(result.contextData.labels.nodes).toEqual([{ name: "bug" }]);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      databaseId: "101",
      body: "a comment",
      author: { login: "bob" },
    });
    expect(result.triggerDisplayName).toBe("Alice A.");
    expect(result.imageUrlMap.size).toBe(0);
  });

  it("maps a merged cross-repo Gitea PR correctly", async () => {
    const result = await fetchGiteaData({
      client: fakeClient(),
      repository: "owner/repo",
      prNumber: "9",
      isPR: true,
    });

    const pr = result.contextData as any;
    expect(pr.state).toBe("MERGED");
    expect(pr.baseRefName).toBe("main");
    expect(pr.headRefName).toBe("feature");
    expect(pr.headRefOid).toBe("abc123");
    expect(pr.isCrossRepository).toBe(true);
    expect(pr.commits.totalCount).toBe(2);
    expect(pr.additions).toBe(3);
  });

  it("respects the originalBody TOCTOU override", async () => {
    const result = await fetchGiteaData({
      client: fakeClient(),
      repository: "owner/repo",
      prNumber: "7",
      isPR: false,
      originalBody: "safe body from webhook",
    });
    expect(result.contextData.body).toBe("safe body from webhook");
  });

  it("throws on a malformed repository string", async () => {
    await expect(
      fetchGiteaData({
        client: fakeClient(),
        repository: "not-a-repo",
        prNumber: "1",
        isPR: false,
      }),
    ).rejects.toThrow("Invalid repository format");
  });
});
