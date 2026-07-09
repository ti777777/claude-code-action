import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import {
  getProviderName,
  getGiteaServerUrl,
  getGiteaApiUrl,
} from "../../src/providers/config";

describe("providers/config", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PROVIDER;
    delete process.env.GITEA_SERVER_URL;
    delete process.env.GITEA_API_URL;
    delete process.env.GITHUB_SERVER_URL;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  describe("getProviderName", () => {
    it("defaults to github", () => {
      expect(getProviderName()).toBe("github");
    });

    it("returns gitea when PROVIDER=gitea (case-insensitive, trimmed)", () => {
      process.env.PROVIDER = "  Gitea ";
      expect(getProviderName()).toBe("gitea");
    });

    it("falls back to github for unknown values", () => {
      expect(getProviderName("gitlab")).toBe("github");
    });

    it("honors an explicit argument over the env var", () => {
      process.env.PROVIDER = "gitea";
      expect(getProviderName("github")).toBe("github");
    });
  });

  describe("getGiteaServerUrl", () => {
    it("prefers GITEA_SERVER_URL and strips trailing slashes", () => {
      process.env.GITEA_SERVER_URL = "https://gitea.example.com/";
      expect(getGiteaServerUrl()).toBe("https://gitea.example.com");
    });

    it("falls back to GITHUB_SERVER_URL (as Gitea Actions injects it)", () => {
      process.env.GITHUB_SERVER_URL = "https://gitea.internal";
      expect(getGiteaServerUrl()).toBe("https://gitea.internal");
    });

    it("throws when no server URL is configured", () => {
      expect(() => getGiteaServerUrl()).toThrow();
    });
  });

  describe("getGiteaApiUrl", () => {
    it("prefers an explicit GITEA_API_URL", () => {
      process.env.GITEA_API_URL = "https://gitea.example.com/api/v1/";
      expect(getGiteaApiUrl()).toBe("https://gitea.example.com/api/v1");
    });

    it("derives from the server URL when GITEA_API_URL is absent", () => {
      process.env.GITEA_SERVER_URL = "https://gitea.example.com";
      expect(getGiteaApiUrl()).toBe("https://gitea.example.com/api/v1");
    });
  });
});
