/**
 * Provider selection and per-provider endpoint resolution.
 *
 * The `provider` workflow input flows in via the PROVIDER env var. GitHub keeps
 * using GITHUB_API_URL / GITHUB_SERVER_URL (which already default to the public
 * github.com endpoints in ../github/api/config). Gitea resolves its endpoints
 * from dedicated GITEA_* env vars, falling back to the GITHUB_* vars that Gitea
 * Actions itself injects (act_runner sets GITHUB_SERVER_URL / GITHUB_API_URL to
 * point at the Gitea instance for GitHub-Actions compatibility).
 */
import type { ProviderName } from "./types";

/** Resolve the configured provider, defaulting to GitHub. */
export function getProviderName(raw?: string): ProviderName {
  const value = (raw ?? process.env.PROVIDER ?? "github").trim().toLowerCase();
  return value === "gitea" ? "gitea" : "github";
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Base web URL of the Gitea instance, e.g. `https://gitea.example.com`.
 * Prefers the explicit GITEA_SERVER_URL, then the GITHUB_SERVER_URL that Gitea
 * Actions provides.
 */
export function getGiteaServerUrl(): string {
  const url = process.env.GITEA_SERVER_URL || process.env.GITHUB_SERVER_URL;
  if (!url) {
    throw new Error(
      "Gitea provider requires GITEA_SERVER_URL (or GITHUB_SERVER_URL) to be set to the Gitea instance URL.",
    );
  }
  return stripTrailingSlash(url);
}

/**
 * REST API base URL of the Gitea instance, e.g.
 * `https://gitea.example.com/api/v1`. Prefers an explicit GITEA_API_URL, then
 * derives it from the server URL.
 */
export function getGiteaApiUrl(): string {
  if (process.env.GITEA_API_URL) {
    return stripTrailingSlash(process.env.GITEA_API_URL);
  }
  return `${getGiteaServerUrl()}/api/v1`;
}
