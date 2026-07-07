/**
 * Configure git authentication for pushing to a Gitea remote — the Gitea
 * counterpart of src/github/operations/git-config.ts. Gitea accepts a token
 * embedded in the clone URL (`https://<token>@host/owner/repo.git`).
 */
import { $ } from "bun";
import type { GitHubContext } from "../../github/context";

type GitUser = {
  login: string;
  id: number;
};

export async function configureGiteaGitAuth(
  token: string,
  serverUrl: string,
  context: GitHubContext,
  user: GitUser,
): Promise<void> {
  console.log("Configuring git authentication for Gitea");

  const url = new URL(serverUrl);
  const host = url.host;
  const noreplyDomain = `users.noreply.${url.hostname}`;

  const botName = user.login;
  const botId = user.id;
  console.log(`Setting git user as ${botName}...`);
  await $`git config user.name "${botName}"`;
  await $`git config user.email "${botId}+${botName}@${noreplyDomain}"`;

  // Remove any authorization header the checkout step may have set.
  try {
    await $`git config --unset-all http.${serverUrl}/.extraheader`;
  } catch {
    console.log("No existing authentication headers to remove");
  }

  const { owner, repo } = context.repository;
  const remoteUrl = `${url.protocol}//${token}@${host}/${owner}/${repo}.git`;
  await $`git remote set-url origin ${remoteUrl}`;
  console.log("✓ Updated Gitea remote URL with authentication token");
}
