# CLAUDE.md

## Commands

```bash
bun test                # Run tests
bun run typecheck       # TypeScript type checking
bun run format          # Format with prettier
bun run format:check    # Check formatting
```

## What This Is

A GitHub Action that lets Claude respond to `@claude` mentions on issues/PRs (tag mode) or run tasks via `prompt` input (agent mode). Mode is auto-detected: if `prompt` is provided, it's agent mode; if triggered by a comment/issue event with `@claude`, it's tag mode. See `src/modes/detector.ts`.

## How It Runs

Single entrypoint: `src/entrypoints/run.ts` orchestrates everything — prepare (auth, permissions, trigger check, branch/comment creation), install Claude Code CLI, execute Claude via `base-action/` functions (imported directly, not subprocess), then cleanup (update tracking comment, write step summary). SSH signing cleanup and token revocation are separate `always()` steps in `action.yml`.

`base-action/` is also published standalone as `@anthropic-ai/claude-code-base-action`. Don't break its public API. It reads config from `INPUT_`-prefixed env vars (set by `action.yml`), not from action inputs directly.

## Key Concepts

**Provider abstraction (GitHub vs Gitea)**: The git remote server is pluggable via the `provider` input (`github` | `gitea`). `src/providers/` defines the `GitProvider` interface and a `getProvider(context)` factory. `run.ts` only touches the provider through four seam methods: `setupToken`, `checkWritePermissions`, `prepare`, and `updateTrackingComment`. The GitHub implementation (`src/providers/github/`) is a thin delegation to the original code paths (zero behavior change). The Gitea implementation (`src/providers/gitea/`) talks to Gitea's REST `/api/v1` (no GraphQL) and ships its own MCP servers (`src/mcp/gitea-*.ts`). Gitea MCP servers are registered under the **same server keys** (`github_comment`, `github_file_ops`) so the shared prompt/tool names stay valid across platforms — only the script behind each key differs.

**Auth priority**: `github_token` input (user-provided) > GitHub App OIDC token (default). The `claude_code_oauth_token` and `anthropic_api_key` are for the Claude API, not GitHub. Token setup lives in `src/github/token.ts`. For `provider: gitea` there is no App exchange — the token comes straight from `github_token` (or the Gitea Actions run token) via `GiteaProvider.setupToken`.

**Mode lifecycle**: `detectMode()` in `src/modes/detector.ts` picks the mode name ("tag" or "agent"). Trigger checking and prepare dispatch are inlined in `run.ts`: tag mode calls `prepareTagMode()` from `src/modes/tag/`, agent mode calls `prepareAgentMode()` from `src/modes/agent/`.

**Prompt construction**: Tag mode's `prepareTagMode()` builds the prompt by fetching GitHub data (`src/github/data/fetcher.ts`), formatting it as markdown (`src/github/data/formatter.ts`), and writing it to a temp file via `createPrompt()`. Agent mode writes the user's prompt directly. The prompt includes issue/PR body, comments, diff, and CI status. This is the most important part of the action — it's what Claude sees.

## Things That Will Bite You

- **Strict TypeScript**: `noUnusedLocals` and `noUnusedParameters` are enabled. Typecheck will fail on unused variables.
- **Discriminated unions for GitHub context**: `GitHubContext` is a union type — call `isEntityContext(context)` before accessing entity-specific fields like `context.issue` or `context.pullRequest`.
- **Token lifecycle matters**: The GitHub App token is obtained early and revoked in a separate `always()` step in `action.yml`. If you move token revocation into `run.ts`, it won't run if the process crashes. Same for SSH signing cleanup.
- **Error phase attribution**: The catch block in `run.ts` uses `prepareCompleted` to distinguish prepare failures from execution failures. The tracking comment shows different messages for each.
- **`action.yml` outputs reference step IDs**: Outputs like `execution_file`, `branch_name`, `github_token` reference `steps.run.outputs.*`. If you rename the step ID, update the outputs section too.
- **Integration testing** happens in a separate repo (`install-test`), not here. The tests in this repo are unit tests.

## Code Conventions

- Runtime is Bun, not Node. Use `bun test`, not `jest`.
- `moduleResolution: "bundler"` — imports don't need `.js` extensions.
- GitHub API calls should use retry logic (`src/utils/retry.ts`).
- MCP servers are auto-installed at runtime to `~/.claude/mcp/github-{type}-server/`.
