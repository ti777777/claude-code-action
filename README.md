# Claude Code Action (Gitea fork)

A fork of [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action)
that adds support for running the action against a self-hosted
[Gitea](https://about.gitea.com/) instance, in addition to GitHub.

## What this fork adds

- **Pluggable git remote provider** via the `provider` input (`github` | `gitea`).
  GitHub behaves exactly as upstream; `gitea` routes all platform operations
  (issue/PR data, tracking comments, branches, git auth, MCP servers) through
  Gitea's REST API.
- **Gitea MCP servers** (`gitea-comment-server`, `gitea-file-ops-server`, and a
  general-purpose `gitea-server`) that talk to the Gitea API.
- **Configuration examples** for both providers (below).

For everything else, refer to the upstream
[documentation](https://github.com/anthropics/claude-code-action) — this fork
tracks it and only changes the provider layer.

## Basic Setup

The action works with two git remote server providers, selected via the
`provider` input (default: `github`). Both share the same `@claude` trigger and
Claude configuration—only the platform integration differs.

### GitHub

```yaml
# .github/workflows/claude.yml
name: Claude Code
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]

jobs:
  claude:
    if: contains(github.event.comment.body, '@claude') || contains(github.event.issue.body, '@claude')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: ti777777/claude-code-action@main
        with:
          # provider: github            # default, can be omitted
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Gitea

Gitea Actions is GitHub-Actions compatible, so the workflow is nearly identical.
Gitea has no Anthropic GitHub App, so `github_token` is required (it is reused as
the Gitea access token—the Gitea Actions run token works). When running on the
Gitea instance itself, the endpoints are auto-detected; set `gitea_url` /
`gitea_api_url` only when driving Gitea from a different runner.

```yaml
# .gitea/workflows/claude.yml
name: Claude Code
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]

jobs:
  claude:
    if: contains(github.event.comment.body, '@claude') || contains(github.event.issue.body, '@claude')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ti777777/claude-code-action@main
        with:
          provider: gitea
          github_token: ${{ secrets.GITHUB_TOKEN }} # reused as the Gitea token
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          # gitea_url: https://gitea.example.com       # only if not running on Gitea
          # gitea_api_url: https://gitea.example.com/api/v1
```

See [docs/configuration.md](./docs/configuration.md#git-remote-provider-github-or-gitea)
for the full provider reference.

## License

This project is licensed under the MIT License—see the LICENSE file for details.
