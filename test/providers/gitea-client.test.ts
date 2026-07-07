import { describe, expect, it, afterEach } from "bun:test";
import { GiteaClient } from "../../src/providers/gitea/client";

type Call = { url: string; init: RequestInit };

function stubFetch(
  handler: (url: string, init: RequestInit) => Response,
): Call[] {
  const calls: Call[] = [];
  global.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  return calls;
}

const originalFetch = global.fetch;

describe("GiteaClient", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("builds authenticated GET requests against the api base", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ number: 7, title: "T" })),
    );
    const client = new GiteaClient(
      "tok_123",
      "https://gitea.example.com/api/v1",
    );

    const issue = await client.getIssue("owner", "repo", 7);

    expect(issue).toMatchObject({ number: 7, title: "T" });
    expect(calls[0]!.url).toBe(
      "https://gitea.example.com/api/v1/repos/owner/repo/issues/7",
    );
    expect(calls[0]!.init.method).toBe("GET");
    expect(
      (calls[0]!.init.headers as Record<string, string>).Authorization,
    ).toBe("token tok_123");
  });

  it("sends a JSON body on PATCH when updating a comment", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ id: 5, body: "updated" })),
    );
    const client = new GiteaClient("tok", "https://gitea.example.com/api/v1");

    await client.updateIssueComment("owner", "repo", 5, "updated");

    expect(calls[0]!.init.method).toBe("PATCH");
    expect(calls[0]!.url).toBe(
      "https://gitea.example.com/api/v1/repos/owner/repo/issues/comments/5",
    );
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      body: "updated",
    });
  });

  it("does not retry 4xx errors and surfaces the status", async () => {
    const calls = stubFetch(() => new Response("nope", { status: 404 }));
    const client = new GiteaClient("tok", "https://gitea.example.com/api/v1");

    await expect(client.getIssue("owner", "repo", 1)).rejects.toThrow(/404/);
    // A single attempt: 4xx is classified as non-retryable.
    expect(calls).toHaveLength(1);
  });

  it("getFileSha returns null on a missing file", async () => {
    stubFetch(() => new Response("not found", { status: 404 }));
    const client = new GiteaClient("tok", "https://gitea.example.com/api/v1");
    expect(await client.getFileSha("o", "r", "missing.txt", "main")).toBeNull();
  });
});
