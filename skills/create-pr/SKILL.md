---
name: create-pr
description: Open a pull request (or merge request) on GitHub, GitLab, Bitbucket or Azure DevOps, linked to its ticket in whatever tracker the repo uses (Linear, Jira, GitHub Issues, Azure Boards, Trello, …). It finds the ticket, checks it matches the diff, offers to create one when there is none, and links it so the tracker follows the PR. The description leads with user impact - a three-bullet TL;DR, numbered user-facing changes, developer-facing notes, tests, and a manual QA table with one row per user-facing change. Before opening it, the agent checks what local dev is connected to, runs every QA row that is safe there in the user's own browser and marks those rows 🤖. The rest stay ⬜ for the user to flip to ✅. Adds a release-notes entry when the repo has one and users can see the change. Every run ends with a review from a fresh agent session, then a `resolve-pr-issues` pass on every review comment. Use when asked to create, open, or raise a PR or MR, "make a PR for this branch", or "ship this as a PR".
---

# Create a PR

The description is written for a reviewer who tests by using the app. Lead with what the end user notices. Implementation detail goes last and stays short.

"PR" below also means a GitLab merge request. `<code host>` is where the repo lives (GitHub, GitLab, Bitbucket, Azure DevOps), and `<tracker>` is where its tickets live.

Every PR is tied to a ticket in the repo's tracker: Linear, Jira, GitHub or GitLab issues, Azure Boards, Shortcut, ClickUp, Asana, Trello, or another. The link is what lets the tracker follow the PR and move the ticket as the PR opens and merges. Depending on the tracker, it reads the id from the branch name or the PR title (`ENG-123`), a closing keyword in the body (`Closes #123`), or a pasted ticket URL. A PR the tracker can't link is invisible to it, so its ticket sits untouched until someone moves it by hand. How each tracker links, and how to look up and create tickets in it, is in [REFERENCE.md → Issue trackers](REFERENCE.md#issue-trackers).

## Discover the project first

Read these once, and use what they say everywhere below instead of assuming:

- `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md`, or the agent's own instructions file, and the PR/MR template: commands, migration rules, title conventions, release-notes rules, ticket rules, and what local dev is connected to.
- **Code host**: from `git remote get-url origin` (github.com or a GitHub Enterprise host, gitlab.com or a self-hosted GitLab, bitbucket.org, dev.azure.com / visualstudio.com), confirmed by which CLI is installed and authenticated. The commands for each host are in [REFERENCE.md → Code hosts](REFERENCE.md#code-hosts). If no CLI or token for the host is available, ask the user once. Without one, do steps 1–7, hand the user the title and body file to open the PR themselves, and say in the report that the review steps didn't run.
- **Default branch** (`<default>` below): `git symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'`. If that's unset, run `git remote set-head origin --auto` first.
- **Package manager and runner** (`<pm>` below), from the lockfile. JS: `bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm. Python: `uv.lock` → uv, `poetry.lock` → poetry, `Pipfile.lock` → pipenv, else pip. Others: `Cargo.lock` → cargo, `go.mod` → go, `Gemfile.lock` → bundler, `composer.lock` → composer, `mix.lock` → mix. Scripts come from `package.json`, `pyproject.toml`, or a `Makefile` / `justfile` / `Taskfile.yml`, and run through the repo's own runner.
- **CI gates**: the CI config shows which scripts CI runs, and on which paths: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `azure-pipelines.yml`, `.circleci/config.yml`, `Jenkinsfile`, or `.buildkite/`.
- **Title convention**: `git log --oneline -20 origin/<default>`. Check for Conventional Commits and a ticket-id suffix.
- **Tracker** (`<tracker>` below). Stop at the first clear answer:
  1. The repo docs above, the PR/MR template, and README badges.
  2. Ids or ticket links in recent PR titles, branch names and commit messages. The commands and id forms are in [REFERENCE.md → Detect the tracker](REFERENCE.md#detect-the-tracker).
  3. Tracker MCP servers connected in this session, and tracker CLIs on PATH.
  4. The code host's own issues, if they're enabled and in recent use.
  5. Still unclear, or several candidates: ask the user once which tracker this repo uses, with your guess, and use the answer for the rest of the run.
- **Ticket id form**: the tracker's row in [REFERENCE.md → Issue trackers](REFERENCE.md#issue-trackers), plus what recent titles and branches show. That's the team or project key for Linear and Jira (`ENG-123`), `#123` for GitHub and GitLab issues, `AB#123` for Azure Boards on GitHub, `sc-123` for Shortcut, and a URL for trackers with no id. `ABC-123` can be Linear, Jira or YouTrack, so tell them apart by which tool is connected and which one resolves the id.
- **Scratch directory** (`<scratch>` below): if `git check-ignore -q .context/pr/probe.md` succeeds, use `.context/pr/`, otherwise `mktemp -d`. Never use a fixed `/tmp` path, because it collides across worktrees and sessions. Name files `<branch-slug>`, which is the branch name with `/` replaced by `-`.

## Workflow

1. **Read the branch, not your memory of it.**
   ```bash
   git status --short
   git fetch origin <default>
   git log --oneline origin/<default>..HEAD
   git diff --stat origin/<default>...HEAD
   ```
   Then look for an open PR from this branch with the host's "find" command ([REFERENCE.md → Code hosts](REFERENCE.md#code-hosts)).
   - If a PR already exists, don't create another. Update its body instead (step 9).
   - Uncommitted changes: ask whether they belong in the PR. A hook or tool may auto-commit and push, so check `git log -1 origin/<branch>` before claiming anything is or isn't pushed.
   - If `origin/<default>` already contains the same fix, re-scope honestly or stop and say so. Parallel worktrees and agents often pick up sibling tickets.

2. **Find the ticket.** Check these in order and stop at the first hit:
   - the branch name: trackers that generate branches put the id in them (Linear's look like `<user>/<prefix>-<n>-<slug>`)
   - the commit messages: `git log origin/<default>..HEAD`, searched for the tracker's id form
   - a ticket your tooling linked to this worktree, if any
   - the conversation: the user may have named the ticket

   **Confirm the ticket exists and matches the diff** with the tracker's lookup ([REFERENCE.md → Check that the ticket fits](REFERENCE.md#check-that-the-ticket-fits)). A branch reused for other work can carry a stale id. If the ticket describes other work, or is already closed, say so and ask whether to use it anyway, pick another, or create one. If the tracker's tool isn't connected, say you couldn't check it and ask the user to confirm the id.

   **No ticket found? Always offer to create one before opening the PR.** Don't skip the question, and don't file on your own. Ask once, and include a draft title and where you'd file it (the team, project, board or list), so the user only has to say yes:
   - **Yes:** create it in `<tracker>` with its create command ([REFERENCE.md → Create a ticket](REFERENCE.md#create-a-ticket)). The diff you just read counts as the investigation, so the body can cite `file:line` evidence. Then use the new id or URL. Never file it in a different tracker. If the tool isn't connected, or it's signed in to a workspace with nowhere that matches this repo, stop and say so. Give the user the draft title and body to file themselves, and use the id they give back.
   - **No:** open the PR without a ticket, and say in the final report that the tracker won't follow it.

   If the user said in discovery that the repo has no tracker, skip this step and say so in the report.

3. **Classify every change from the diff.** Read the changed files, not just the stat.
   - **User-facing**: anything an end user, admin, or email recipient can see or feel. That covers UI, copy, routes, emails, permissions, performance they would notice, and data they see.
   - **Developer-facing**: tooling, refactors, deps, tests, docs, and migrations with no visible effect.

4. **Add a release-notes entry, if the repo has a mechanism for one.** Look for `CHANGELOG.md`, `.changeset/`, an in-app "What's New" data file, or a rule in `AGENTS.md`. If there's none, skip this step and say so in Notes. If there is one:
   - **Add an entry** when step 3 found at least one user-facing change. If you're unsure, add one, because a one-line `fix` entry costs almost nothing.
   - **Skip it** when the PR is developer-facing only, or when its user-facing change is still behind a flag or can't be reached yet. The PR that turns the change on gets the entry.
   - **One entry per PR.** If the branch already has one, update it to match the final diff instead of adding a second.
   - Follow [REFERENCE.md → Release notes](REFERENCE.md#release-notes) for the format, date keys, and same-day collisions. Commit the entry on the branch. Add the repo's i18n or format check to step 5 if the entry touches localized files. Quote the entry text in the final report so the user can edit it.

5. **Run the checks you will claim.** List only checks that actually ran and passed, and report failures with their output.
   - Use the repo's own runner (`<pm> run <script>`, `make <target>`, `just <recipe>`, `uv run …`, `cargo test`, `go test ./...`). Some runners have built-ins that shadow script names. For example, bare `bun test`, `bun build`, and `bun ci` run Bun's own commands, not the `package.json` scripts, and a built-in can exit 0 without running a single gate.
   - Read an aggregate CI script before you run it. If any step mutates the tree (a `--write` formatter, `lint --fix`, a codemod, a comment stripper), never run it on a dirty tree. Commit first, or run the read-only steps one at a time.
   - Run the baseline (typecheck, lint, and tests, under whatever names the repo uses), plus the gates CI runs for the areas the diff touches.

6. **Draft the body** in `<scratch>/<branch-slug>.md` using the template below. Every QA row starts as ⬜.

7. **Run the QA table yourself in the user's browser**, following [Browser QA](#browser-qa) below. Mark each row you ran and saw pass 🤖. Leave every other row ⬜, with the reason in the row. Don't open the PR while a row you ran is failing. Fix it if it's in scope, or stop and tell the user.

8. **Create the PR.** Push only if the branch isn't on the remote yet. Match the repo's title convention, then link the ticket the way `<tracker>` expects (the "Link and close on merge" column in [REFERENCE.md → Issue trackers](REFERENCE.md#issue-trackers)):
   - **Id in the title** (Linear, Jira, Shortcut, ClickUp, and others whose integration reads titles): with Conventional Commits, that looks like `feat(billing): retry a failed renewal once (ENG-241)`. The id goes at the end in parentheses, and several ids are separated by commas, as in `(ENG-86, ENG-74)`. Use the tracker's own form where its row gives one, such as `[sc-123]` for Shortcut. If the repo squash-merges, the title becomes the commit on `<default>`, so the id also stays in the git history.
   - **Closing keyword in the body** (GitHub and GitLab issues): `Closes #<n>` on the ticket line in Notes. It closes the issue only when the PR merges into the default branch.
   - **URL in the body** (Asana, Trello, Notion, and trackers with no id): the ticket URL on the ticket line in Notes.
   - **Azure Boards**: `AB#<n>` in the title or body on GitHub. On Azure Repos, link the work item when you create the PR.

   ```bash
   git push -u origin HEAD
   ```
   Look for an open PR again, because a push hook may have opened one already. If one exists, fix that PR with the host's update command instead of creating a second one. Otherwise create it with the host's create command, with `<default>` as the base, the title, and `<scratch>/<branch-slug>.md` as the body ([REFERENCE.md → Code hosts](REFERENCE.md#code-hosts)).

   **Partial work** (the ticket should stay open after this merges): use the tracker's non-closing link from the "Partial work" column instead. For example, leave the id out of the title and write `Part of ENG-123` (Linear) or `Refs #123` (GitHub issues) on the ticket line. No closing keyword anywhere, commit messages included. Some trackers also link and move the ticket from the branch name (a Linear `<prefix>-<n>-…` branch will still move the issue), or from an automation rule on merge. Point that out to the user if it matters.

9. **Updating an existing PR:** read its current title and body ([REFERENCE.md → Code hosts](REFERENCE.md#code-hosts)) and replace only the human-authored part. Keep auto-generated blocks (bot summaries in `<!-- … -->` markers) intact. Keep every ✅ and 🤖 on a QA row that still applies. Reset a row to ⬜ only if its behavior changed since it was marked, then rerun step 7 for new and reset rows. Then write the body back with the host's update command. If the PR isn't linked to its ticket, run step 2 and add the link as step 8 describes (the title or the ticket line). If the user-facing changes have changed, rerun step 4 so the release-notes entry still matches the diff.

10. **Get a review of the PR from a fresh agent session, every time this skill runs, updates (step 9) included.** This session wrote the code and the PR body, so it reads them with the author's blind spots. A fresh process starts without that context and reviews the PR the way a stranger would. Run it in the background from a checkout of the PR's branch, save its output to `<scratch>/<branch-slug>.review.md`, and keep working until it exits.
    - **Claude Code:** run `/code-review` in a fresh `claude` process:
      ```bash
      claude -p "/code-review <PR#> --comment" --permission-mode bypassPermissions \
        > <scratch>/<branch-slug>.review.md 2>&1
      ```
      Pass the PR number, not the branch, so the review targets what's on the code host. If `/code-review` can't read PRs on this host, pass the branch name instead and drop `--comment`.
    - **Other agents:** run the agent's own CLI non-interactively (for example `codex exec "<prompt>"`, `cursor-agent -p "<prompt>"`, or `gemini -p "<prompt>"`), with the self-contained prompt in [REFERENCE.md → Fresh review for other agents](REFERENCE.md#fresh-review-for-other-agents) and its output redirected to the same file. Check the CLI's `--help` for the flags that let it read the repo and run git and the host CLI without prompting.
    - No CLI can start a fresh session: say so in the report and suggest the user run a review. Don't review it in this session and call that independent.
    - `--comment` (or the posting line in the other-agent prompt) posts each finding as a PR comment. Use it only on PRs the user owns, and drop it when they asked for findings in chat only. Use `--fix` only if the user asked for it.
    - Never run the review in this session or in a subagent that inherits this context (a `fork` agent in Claude Code): both carry the author's context, which defeats the point.
    - Wait for the process to exit, then read the saved output. Don't fold its findings silently into your own judgment: a finding you reject is reported as rejected, with the reason.

11. **Run the `resolve-pr-issues` skill on the PR as soon as the review exits, every time, updates included.** Run it in this session: through the Skill tool (`/resolve-pr-issues <PR#>`) in Claude Code, or by loading that skill's SKILL.md and following it in other agents. The review needed a fresh session to judge the code. Acting on its findings against the current branch is where this session's context helps.
    - It covers every feedback surface, not only the review's inline comments: other bots' threads, review summaries, and top-level comments. Findings that exist only in the saved review output (because nothing posted them) count too.
    - For each item it checks the finding against the current head, then fixes it, declines it with the repository fact behind the decision, or marks it already addressed. It replies on every thread before resolving it, and posts one ledger comment for the items that have no resolve control.
    - If that skill isn't installed or doesn't support this code host, do the same pass by hand with the host's CLI or API, and say so in the report.
    - A create-PR run counts as the request to commit and push its fixes. Commit them deliberately (a hook may also auto-commit), rerun the step 5 checks they touch, and push.
    - If code changed, redo step 9's body edit so the body stays accurate, and rerun step 7 for each QA row reset to ⬜. That edit doesn't start another review.
    - Finish with the skill's verify step (or, by hand, a fresh listing of the PR's threads) showing no unresolved review thread.
    - Don't start another review round unless the user asks. One review and one resolve pass per run keeps the loop finite.

12. **Report:**
    - the PR URL
    - the linked ticket (tracker, id or URL, and how it's linked), or that there isn't one and why
    - the release-notes entry and its text, or why there's none
    - the checks that ran
    - the QA split: how many rows are 🤖 and how many ⬜, and which account ran them
    - every write made to the logged-in user's own data
    - the dev server URL, left running so the user can do the ⬜ rows
    - the review: the number of findings, each on its own line with its file and severity, and what happened to it (fixed, declined with the reason, or already addressed)
    - the resolve pass: how many threads were fixed, declined and already addressed, the ledger comment's URL, and the verify result
    - anything you could not verify

## Body template

```markdown
## TL;DR
- **What:** <one sentence on the outcome for users, or "Developer-facing only: …">
- **Risk:** <the one behavior most likely to break, or "Low — …" with the reason>
- **Before merge:** <migration to apply / env var / flag, or "Nothing">

## User-facing changes
### 1. <change> — <what the end user notices (behavior, not files)>
### 2. …

## Developer-facing
- <tooling / refactor / deps with no user-visible effect — keep short>

## Tests & checks
- <tests added/updated, by file or area>
- <checks that ran and passed, e.g. `<pm> run typecheck`, `<pm> run test`>

## How to verify (manual QA)
<optional one-line general rule, e.g. "Log in as an admin.">

🤖 the agent ran it on local dev as `<session email>` · ⬜ yours to test · ✅ you tested it

| ✓ | Where | Do | Expect |
| --- | --- | --- | --- |
| 🤖 | <route / screen> | <action> | <observable result> |
| ⬜ | <route / screen> | <action> _Left for you: <reason>._ | <observable result> |

## Notes
- <ticket line, when the tracker links through the body (step 8): `Closes #123`, `Part of ENG-123`, or the ticket URL>
- Release notes: <added `<entry>` | none — <why: developer-facing only / behind a flag / no mechanism>>
- Browser QA: <what local dev was connected to; writes the agent made to `<session email>`'s own data and uploaded storage keys — or "read-only">
- <follow-ups / intentional removals / caveats / unapplied migrations>
```

End the body with the attribution line your harness asks for, if any.

## Browser QA

### First: what is local dev connected to?

Before you run any row, find out what the dev server reads and writes. Check this without printing a secret value; the commands are in [REFERENCE.md → What local dev is connected to](REFERENCE.md#what-local-dev-is-connected-to).

- **Production data, live keys, or you can't tell:** every click is a real production action. Apply the row rules below strictly. Never create fixture rows or users to make a row testable.
- **An isolated local or test database with sandbox keys:** writes to local data are fine, and the repo's own seed script may set up preconditions. The row rules below still apply to anything that leaves the machine: sends, payments, shared storage buckets, outbound webhooks, and crons that trigger them.

### Which rows you may run

Run a row only if every action in it is one of these two kinds:
- **Read-only.** Navigate, open a dialog, menu, or tab, filter, sort, search, page, change the viewport, hover, or type into a field without submitting.
- **A write to the logged-in user's own data that they can undo or overwrite.** For example: their profile, their settings or theme, their own draft or conversation, or a file they upload for themselves.

Everything else stays ⬜ for the user:
- **Writes to shared data or to anyone else's data.** That covers content other users see (catalog items, public pages, shared templates, org settings). It also covers any admin action on a record that isn't the logged-in user's own, every bulk action, and status changes on shared records.
- **Reads that write shared state.** Opening an unread item can clear its unread flag for everyone. A view can also bump a counter, claim a lock, or mark something seen. If you're not sure whether a click writes, read its handler and the server code it calls first. If you're still not sure, leave the row ⬜.
- **Anything sent to someone other than the logged-in user.** That covers emails, replies, SMS or chat messages, invitations, and outbound webhooks.
- **Money, even the user's own.** Stop at the payment provider's redirect and never enter a card. Refunds, coupons, credits, and gift cards are off-limits too.
- **Crons and queues.** Never press a "run now" control for a scheduled job or queue, and never call cron endpoints (they're listed in the scheduler config). They claim due work for every user.
- **Own-user actions that can't be undone.** For example, deleting the account, or submitting something that other people will process.
- **Impersonation.** Never start one. If the session is impersonated, the logged-in user is a real person, so run only read-only rows.
- **Rows that need an unapplied migration.** The branch code expects a schema the connected database doesn't have yet. Leave the row ⬜, say so in Notes, and never apply the migration.
- **Rows local dev can't judge.** Timing targets are an example, because dev builds are much slower.

Never log in, log out, or change the user's email or password yourself.

### Steps

1. **Serve this branch.** Another worktree's dev server may hold the port, and it serves different code. Follow [REFERENCE.md → Serving the branch](REFERENCE.md#serving-the-branch) to reuse or start the right server.
2. **Open the user's real browser, with their own session.**
   - **Claude Code:** load the `claude-in-chrome` skill, then open a new tab.
   - **Other agents:** use a browser tool that attaches to the user's own browser and logged-in session, for example a Chrome DevTools or Playwright MCP connected to their profile, and open a new tab.

   Don't reuse the user's existing tabs. If no such tool is connected, ask the user. Don't fall back to a headless browser or a fresh profile, because it has no logged-in session. If nothing can attach, leave every row ⬜ with `_Left for you: no browser attached to your session._`
3. **Check who is logged in.** Call the auth library's session endpoint from the page with the browser tool's run-JavaScript action (`javascript_tool` in Claude in Chrome). Return only the identity fields. The full response can include the session token, which must never land in the transcript or the PR. With Better Auth, for example:
   ```js
   const s = await fetch('/api/auth/get-session').then(r => r.json()); s && { email: s.user.email, role: s.user.role, impersonatedBy: s.session.impersonatedBy }
   ```
   With Auth.js, use `/api/auth/session` and return `s?.user?.email`. If the app has no session endpoint, read the account name, email and role from the UI (the account menu or profile page), never from cookies or storage.
   - No session: stop and ask the user to log in with the role the rows need. Re-check once they say they're done.
   - Wrong role for most rows: ask the user once to switch. Rows that still need a different role stay ⬜.
   - Impersonated: only read-only rows are allowed.
   - Record the session email. It goes in the table legend.
4. **Run each allowed row** exactly as written: the route, the control, the expected result. In local dev, client components often don't hydrate until you interact, so click once inside the region before you decide a control is dead.
   - Log each row in `<scratch>/<branch-slug>-qa.md`: what you did, what you saw, and any write you made to the user's own data. Include uploaded storage keys, because dev uploads may land in a real bucket.
   - **Pass:** mark the row 🤖.
   - **Fail:** don't mark it. It's a bug on this branch. Fix it if it's in scope, rerun the step 5 checks and the row, and only then continue.
   - **Skipped:** leave it ⬜ and add `_Left for you: <reason>._` at the end of its Do cell. The reason is one of the categories above.
5. **Leave the dev server running** and put its URL in the report, so the user can run the ⬜ rows on the same build.

## Rules

- **Every PR links its ticket the way the tracker expects** (step 8): the id at the end of the title where the tracker reads titles, a closing keyword where it reads those, or the ticket URL where it has no id. A mention the tracker doesn't parse leaves the ticket where it was. If there is no ticket, offer to create one first (step 2), in the repo's own tracker only.
- **A user-facing PR ships a release-notes entry** when the repo has a mechanism for one (step 4). Notes names the entry, or explains why there isn't one.
- **The TL;DR is the first section and has exactly the three bullets.** A reviewer should be able to decide how carefully to review from the TL;DR by itself. No file paths, and no detail that belongs in the sections below.
- **Lead with user impact, not implementation.** No file paths in "User-facing changes".
- **The ✓ column holds ⬜, 🤖 or ✅.** The agent sets 🤖 only on rows it ran in the browser and saw pass. The user sets ✅ by editing the PR body. Every row the agent didn't run stays ⬜ and says why. Keep it a table column of these emoji, not checkboxes: GitHub renders `[ ]` in a table cell as literal text and strips `<input>`, and only list items get clickable checkboxes there. Other hosts render checkboxes in tables differently (GitLab draws one only when it's alone in a cell), while the emoji read the same everywhere.
- **Never make a browser QA write that reaches beyond the logged-in user's own data** when local dev is connected to production or you can't tell.
- **Every** numbered user-facing change has at least one matching row in "How to verify". Add explicit **regression-check** rows for nearby behavior the change could break, and label them as such in the Do column.
- **QA rows are specific:** the real route (`/settings/profile`, `/admin/users`), how to reach it (role, modal, wizard step, viewport), the exact control with its label as the UI shows it, in the UI's language ("click **Save**"), and the observable result. Never "test that it works".
- **No user-facing changes?** Write "None — developer-facing only." under the heading, and keep a regression row in the QA table for the most exposed surface.
- **Accurate to the current implementation.** Nothing aspirational, and nothing from an earlier iteration of the branch. If a check was skipped or a behavior couldn't be verified locally (it needs prod data, a logged-in session, or a migration), say so in Notes.
- **Migrations:** state in Notes whether one is included and how it gets applied. If the repo's `AGENTS.md` / `CLAUDE.md` says migrations are applied by hand, never run its push or migrate commands yourself.
- **Every run ends with a review from a fresh agent process** (step 10: `/code-review` in a fresh `claude -p` process in Claude Code, the agent's own non-interactive CLI elsewhere), never in this session or a subagent that inherits its context. The report lists every finding and what happened to it.
- **The `resolve-pr-issues` pass always runs right after the review** (step 11), in this session. Every thread gets a reply and is resolved, every other comment is in the ledger, and the verify step shows no unresolved thread before the report goes out.
