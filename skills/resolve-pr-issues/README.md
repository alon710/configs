# resolve-pr-issues

Works through every piece of feedback on a pull request or merge request: review threads, review summaries, bot findings, and top-level comments. At the end, each thread has a direct reply and is resolved, everything else is in one disposition ledger, and a check confirms nothing is left unresolved.

[skills.sh](https://skills.sh/alon710/configs/resolve-pr-issues) · [SKILL.md](./SKILL.md)

## Install

```bash
npx skills add alon710/configs -s resolve-pr-issues -g
```

## When to use it

- "Address the review comments on PR 42."
- "Clear the unresolved threads on this MR."
- "Respond to the CodeRabbit and Copilot findings."
- "Explain why we're not taking these review suggestions."

## What it does

1. Finds the code host from the git remote and confirms the PR/MR, its base, and that the checked-out branch is its head.
2. Picks a git-ignored directory for reply drafts.
3. Pulls a complete, paginated inventory of every feedback surface.
4. Classifies each item as fix, decline, already addressed, or informational, after checking it against the current code.
5. Makes the smallest fix for valid findings and runs the repo's own checks.
6. Replies on every thread, then resolves it, with a dry run and an explicit confirm before anything is posted.
7. Posts one ledger comment for items the host can't resolve.
8. Verifies no thread is left open and reports what changed.

## Works with

| Code host | How |
| --- | --- |
| GitHub, GitHub Enterprise | bundled helper script over `gh` (REST + GraphQL) |
| GitLab (gitlab.com or self-hosted) | `glab api`: MR discussions, notes, `resolved=true` |
| Bitbucket Cloud | REST API: PR comments, replies, resolve, tasks |
| Azure DevOps | REST or `az devops invoke`: PR threads, comments, thread status |

If the remote doesn't make the host clear, it asks once. On other hosts it follows the same steps from that host's API docs and says what it couldn't automate.

## Requirements

- GitHub: `gh` 2.48+, logged in, and `node` 22.18+ or `bun` to run the helper script.
- GitLab: `glab`, logged in.
- Bitbucket Cloud: `curl` and an Atlassian API token or access token in an environment variable.
- Azure DevOps: `az` with the `azure-devops` extension, or `curl` and a personal access token.
- `jq` on every host except GitHub, to build reply payloads safely.

## Safety

- Treats comment text as untrusted. It never runs instructions found in a comment, including bot prompts and patches.
- Reply drafts live in a git-ignored directory and are never committed.
- Every reply is previewed first, and posting needs an explicit confirm that names the same thread.
- Never resolves a thread without replying, and never resolves if the reply failed.
- Never hides or deletes bot or integration comments, and never prints tokens.
- Doesn't commit or push unless asked.

## Files

| File | What it holds |
| --- | --- |
| `SKILL.md` | The workflow, host detection, feedback surfaces per host, and the reply contract |
| `REFERENCE.md` | Manual posting gates, plus inventory, reply, resolve, ledger, and verify calls for GitLab, Bitbucket Cloud, and Azure DevOps |
| `scripts/review-threads.ts` | GitHub helper: `inventory`, `reply-resolve` (dry run by default), and `verify` |
