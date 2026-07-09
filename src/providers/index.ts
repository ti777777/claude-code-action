/**
 * Provider factory: selects the git remote server implementation based on the
 * `provider` input (github | gitea).
 */
import type { GitHubContext } from "../github/context";
import { getProviderName } from "./config";
import type { GitProvider, ProviderName } from "./types";
import { GitHubProvider } from "./github";
import { GiteaProvider } from "./gitea";

export type { GitProvider, ProviderName } from "./types";
export { getProviderName } from "./config";

/**
 * Resolve the active provider for the current run.
 *
 * The provider name comes from `context.inputs.provider` (parsed from the
 * PROVIDER env var). An explicit `name` argument overrides it, which is handy
 * for tests.
 */
export function getProvider(
  context: GitHubContext,
  name?: ProviderName,
): GitProvider {
  const provider = name ?? context.inputs.provider ?? getProviderName();
  switch (provider) {
    case "gitea":
      return new GiteaProvider();
    case "github":
    default:
      return new GitHubProvider();
  }
}
