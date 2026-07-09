import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { getProvider } from "../../src/providers";
import { GitHubProvider } from "../../src/providers/github";
import { GiteaProvider } from "../../src/providers/gitea";
import { createMockContext } from "../mockContext";

describe("providers/getProvider", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.GITEA_SERVER_URL = "https://gitea.example.com";
    process.env.GITEA_API_URL = "https://gitea.example.com/api/v1";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("returns a GitHubProvider by default", () => {
    const provider = getProvider(createMockContext());
    expect(provider).toBeInstanceOf(GitHubProvider);
    expect(provider.name).toBe("github");
  });

  it("returns a GiteaProvider when the context selects gitea", () => {
    const provider = getProvider(
      createMockContext({ inputs: { provider: "gitea" } }),
    );
    expect(provider).toBeInstanceOf(GiteaProvider);
    expect(provider.name).toBe("gitea");
    expect(provider.apiUrl).toBe("https://gitea.example.com/api/v1");
    expect(provider.serverUrl).toBe("https://gitea.example.com");
  });

  it("honors an explicit name override", () => {
    const provider = getProvider(createMockContext(), "gitea");
    expect(provider).toBeInstanceOf(GiteaProvider);
  });
});
