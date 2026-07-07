/**
 * Gitea provider — implements the {@link GitProvider} contract against Gitea's
 * REST API.
 *
 * Auth: Gitea has no Anthropic GitHub-App OIDC exchange, so the token is taken
 * directly from the `github_token` input (reused as the platform token) or,
 * failing that, the Gitea Actions run token exposed as GITHUB_TOKEN.
 */
import * as core from "@actions/core";
import { getGiteaApiUrl, getGiteaServerUrl } from "../config";
import type {
  GitProvider,
  PrepareResult,
  ProviderName,
  UpdateTrackingCommentParams,
} from "../types";
import type { GitHubContext, ParsedGitHubContext } from "../../github/context";
import type { AutoDetectedMode } from "../../modes/detector";
import { GiteaClient } from "./client";
import { prepareGiteaTagMode, prepareGiteaAgentMode } from "./prepare";
import { updateGiteaTrackingComment } from "./comments";

function isAllowedNonWriteUser(
  actor: string,
  allowedNonWriteUsers: string | undefined,
): boolean {
  if (!allowedNonWriteUsers) return false;
  const trimmed = allowedNonWriteUsers.trim();
  if (trimmed === "*") return true;
  return trimmed
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .includes(actor);
}

export class GiteaProvider implements GitProvider {
  readonly name: ProviderName = "gitea";
  readonly apiUrl: string;
  readonly serverUrl: string;

  constructor() {
    this.apiUrl = getGiteaApiUrl();
    this.serverUrl = getGiteaServerUrl();
  }

  async setupToken(): Promise<string> {
    const token =
      process.env.OVERRIDE_GITHUB_TOKEN || process.env.DEFAULT_WORKFLOW_TOKEN;
    if (!token) {
      throw new Error(
        "Gitea provider requires a token. Provide `github_token` (reused as the Gitea access token) or ensure the Gitea Actions run token is available.",
      );
    }
    core.setSecret(token);
    return token;
  }

  async checkWritePermissions(
    token: string,
    context: ParsedGitHubContext,
  ): Promise<boolean> {
    const { repository, actor } = context;

    // Bypass for explicitly allow-listed non-write users (github_token path).
    if (
      isAllowedNonWriteUser(actor, context.inputs.allowedNonWriteUsers) &&
      !!process.env.OVERRIDE_GITHUB_TOKEN
    ) {
      core.warning(
        `⚠️ SECURITY WARNING: Bypassing write permission check for ${actor} due to allowed_non_write_users configuration.`,
      );
      return true;
    }

    const client = new GiteaClient(token, this.apiUrl);
    try {
      const { permission } = await client.getCollaboratorPermission(
        repository.owner,
        repository.repo,
        actor,
      );
      core.info(`Gitea permission level for ${actor}: ${permission}`);
      return (
        permission === "admin" ||
        permission === "write" ||
        permission === "owner"
      );
    } catch (error) {
      core.error(`Failed to check Gitea permissions: ${error}`);
      throw new Error(`Failed to check permissions for ${actor}: ${error}`);
    }
  }

  prepare(params: {
    mode: AutoDetectedMode;
    context: GitHubContext;
    token: string;
  }): Promise<PrepareResult> {
    const { mode, context, token } = params;
    const shared = {
      context,
      token,
      apiUrl: this.apiUrl,
      serverUrl: this.serverUrl,
    };
    return mode === "tag"
      ? prepareGiteaTagMode(shared)
      : prepareGiteaAgentMode(shared);
  }

  async updateTrackingComment(
    params: UpdateTrackingCommentParams,
  ): Promise<void> {
    const client = new GiteaClient(params.githubToken, this.apiUrl);
    await updateGiteaTrackingComment(client, this.serverUrl, params);
  }
}
