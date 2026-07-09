/**
 * Provider abstraction for the git remote server (GitHub, Gitea, ...).
 *
 * The action was originally hard-wired to GitHub. This interface captures the
 * only operations that actually differ between hosting platforms, so the
 * orchestrator (`src/entrypoints/run.ts`) can stay platform-agnostic and a new
 * provider (Gitea) can be dropped in by implementing this contract.
 *
 * Everything else — webhook payload parsing, trigger detection, prompt
 * generation, formatters, branch-name validation — is platform-neutral and is
 * shared across providers unchanged.
 */
import type { GitHubContext, ParsedGitHubContext } from "../github/context";
import type { BranchInfo } from "../github/operations/branch";
import type { AutoDetectedMode } from "../modes/detector";
import type { UpdateCommentLinkParams } from "../entrypoints/update-comment-link";

/** Supported git remote server types, selectable via the `provider` input. */
export type ProviderName = "github" | "gitea";

/** Result returned by a provider's prepare phase, consumed by run.ts. */
export type PrepareResult = {
  commentId?: number;
  branchInfo: BranchInfo;
  mcpConfig: string;
  claudeArgs: string;
};

/**
 * Parameters for updating the tracking comment during cleanup. This is exactly
 * {@link UpdateCommentLinkParams} minus the GitHub-specific `octokit` client,
 * which each provider constructs internally.
 */
export type UpdateTrackingCommentParams = Omit<
  UpdateCommentLinkParams,
  "octokit"
>;

/**
 * The contract every git remote server implementation must satisfy.
 *
 * Implementations own their own API client construction so callers never touch
 * a provider-specific SDK (Octokit for GitHub, a REST client for Gitea).
 */
export interface GitProvider {
  /** Stable identifier for the provider. */
  readonly name: ProviderName;
  /** REST API base URL (e.g. `https://api.github.com`, `https://gitea.example.com/api/v1`). */
  readonly apiUrl: string;
  /** Web/server base URL (e.g. `https://github.com`, `https://gitea.example.com`). */
  readonly serverUrl: string;

  /** Acquire the platform access token used for all API and git operations. */
  setupToken(): Promise<string>;

  /** Whether the triggering actor has write access to the repository. */
  checkWritePermissions(
    token: string,
    context: ParsedGitHubContext,
  ): Promise<boolean>;

  /** Run the mode-specific prepare phase (comments, branch, MCP config). */
  prepare(params: {
    mode: AutoDetectedMode;
    context: GitHubContext;
    token: string;
  }): Promise<PrepareResult>;

  /** Update the tracking comment with the final job status / links (cleanup). */
  updateTrackingComment(params: UpdateTrackingCommentParams): Promise<void>;
}
