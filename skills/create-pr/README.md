# create-pr

Opens a pull request (or merge request) linked to its ticket in the repo's own tracker, with a description a reviewer can test from: a TL;DR, the user-facing changes, and a manual QA table the agent has already run where it was safe. Every run ends with an independent review and every review comment answered.

[skills.sh](https://skills.sh/alon710/configs/create-pr) · [SKILL.md](./SKILL.md)

## Install

```bash
npx skills add alon710/configs -s create-pr -g
```

## When to use it

- "Create a PR for this branch."
- "Open a merge request and link it to the Jira ticket."
- "Ship this as a PR."
- "The branch changed, update the PR."

## What it does

1. Reads the repo's docs, history and config to learn its code host, tracker, package manager, CI gates and title convention.
2. Finds the ticket from the branch name, commits or conversation and checks that it matches the diff. If there's none, it offers to create one, with a draft title.
3. Sorts every change into user-facing or developer-facing, and adds a release-notes entry when the repo has a mechanism and users can see the change.
4. Runs the checks it will claim: typecheck, lint, tests, and the CI gates the diff touches.
5. Drafts the body: a three-bullet TL;DR, numbered user-facing changes, developer notes, tests, and a QA table with a row per user-facing change.
6. Checks what local dev is connected to, runs the safe QA rows in your own logged-in browser and marks them 🤖. The rest stay ⬜ for you.
7. Opens or updates the PR and links the ticket the way the tracker expects, with a non-closing link for partial work.
8. Has a fresh agent session review the PR, runs `resolve-pr-issues` to fix, answer and resolve every comment, and reports it all.

## Works with

| Area | Detected and supported | When it can't tell |
| --- | --- | --- |
| Issue trackers | Linear, Jira, GitHub Issues, GitLab Issues, Azure Boards, Shortcut, ClickUp, Asana, Trello, Notion, YouTrack | Asks once which tracker the repo uses. Never files a ticket in a different one. |
| Code hosts | GitHub (`gh`), GitLab (`glab`), Bitbucket Cloud (REST API), Azure DevOps (`az repos`) | Asks once. Without access, it hands you the title and body to open the PR yourself. |
| Stacks | bun, pnpm, yarn, npm, uv, poetry, pipenv, pip, cargo, go, bundler, composer, mix, from the lockfile; Make, just and Task runners | Uses the commands the repo docs name. |
| CI | GitHub Actions, GitLab CI, Bitbucket Pipelines, Azure Pipelines, CircleCI, Jenkins, Buildkite | Runs the baseline typecheck, lint and tests. |
| Agents | Claude Code (`/code-review` in a fresh `claude -p`, Claude in Chrome, the Skill tool). Codex, Cursor, Gemini CLI and others through their own non-interactive CLI and a browser tool attached to your session. | Leaves the browser rows to you instead of using a headless browser. |

## Requirements

- git, plus the code host's CLI, signed in: `gh`, `glab`, or `az` with the azure-devops extension. Bitbucket Cloud needs an API token, `curl` and `jq`.
- Access to the tracker through its MCP server or CLI. Optional: without it, the skill gives you the ticket draft to file yourself.
- Optional: a browser tool attached to your own logged-in browser (Claude in Chrome in Claude Code) for the QA rows.
- Optional: the `resolve-pr-issues` skill for the comment pass (`npx skills add alon710/configs -s resolve-pr-issues -g`). Without it, the agent does the same pass by hand.
- Optional: an agent CLI that can run a fresh, non-interactive session for the review.

## Safety

- Never files a ticket without asking, and never in a tracker other than the repo's.
- Checks what local dev is connected to before any browser QA. If it's production or unclear, it only runs read-only rows and undoable writes to the logged-in user's own data.
- Never sends anything to other people, touches money, runs crons or queues, impersonates, logs in or out, or applies migrations during QA. Those rows stay ⬜ for you.
- Prints env var names, hosts and key modes only, never secret values or session tokens.
- Posts review comments only on PRs you own, and never runs the review in the session that wrote the code.
- Commits and pushes only to the PR's branch: the release-notes entry and the fixes from the review pass.

## Files

| File | What it holds |
| --- | --- |
| `SKILL.md` | The workflow, the PR body template, the browser QA rules, and the rules list |
| `REFERENCE.md` | Tracker detection and the per-tracker linking table, per-host PR commands, the fresh-review prompt for other agents, release-notes formats, the local-dev connection check, and serving the branch |
| `README.md` | This overview |
