/**
 * GitHub provider — a thin adapter over the action's original, battle-tested
 * GitHub code paths. It exists so the orchestrator can talk to a single
 * {@link GitProvider} interface; behaviour is intentionally identical to before
 * the provider abstraction was introduced.
 */
import { GITHUB_API_URL, GITHUB_SERVER_URL } from "../../github/api/config";
import { createOctokit } from "../../github/api/client";
import { setupGitHubToken } from "../../github/token";
import { checkWritePermissions } from "../../github/validation/permissions";
import { prepareTagMode } from "../../modes/tag";
import { prepareAgentMode } from "../../modes/agent";
import { updateCommentLink } from "../../entrypoints/update-comment-link";
import type { ParsedGitHubContext, GitHubContext } from "../../github/context";
import type { AutoDetectedMode } from "../../modes/detector";
import type {
  GitProvider,
  PrepareResult,
  ProviderName,
  UpdateTrackingCommentParams,
} from "../types";

export class GitHubProvider implements GitProvider {
  readonly name: ProviderName = "github";
  readonly apiUrl = GITHUB_API_URL;
  readonly serverUrl = GITHUB_SERVER_URL;

  setupToken(): Promise<string> {
    return setupGitHubToken();
  }

  checkWritePermissions(
    token: string,
    context: ParsedGitHubContext,
  ): Promise<boolean> {
    const octokit = createOctokit(token);
    return checkWritePermissions(
      octokit.rest,
      context,
      context.inputs.allowedNonWriteUsers,
      !!process.env.OVERRIDE_GITHUB_TOKEN,
    );
  }

  prepare(params: {
    mode: AutoDetectedMode;
    context: GitHubContext;
    token: string;
  }): Promise<PrepareResult> {
    const { mode, context, token } = params;
    const octokit = createOctokit(token);
    return mode === "tag"
      ? prepareTagMode({ context, octokit, githubToken: token })
      : prepareAgentMode({ context, octokit, githubToken: token });
  }

  updateTrackingComment(params: UpdateTrackingCommentParams): Promise<void> {
    const octokit = createOctokit(params.githubToken);
    return updateCommentLink({ ...params, octokit });
  }
}
