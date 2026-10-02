---
name: create-pr
description: Open a GitHub pull request titled with its issue-tracker id (such as a Linear `ENG-123`), so the tracker moves the issue with the PR. The description leads with user impact - a three-bullet TL;DR, numbered user-facing changes, developer-facing notes, tests, and a manual QA table with one row per user-facing change. Before opening it, Claude checks what the local dev server is connected to, then runs every QA row that is safe there in the user's Chrome and marks those rows 🤖. The rest stay ⬜ for the user to flip to ✅. Adds a release-notes or changelog entry when the repo has one and the PR changes anything users can see. Use when asked to create, open, or raise a PR, "make a PR for this branch", or "ship this as a PR".
---

# Create a PR

The description is written for a reviewer who tests by using the app. Lead with what the end user notices. Implementation detail goes last and stays short.

When the repo tracks work in Linear, every PR is tied to an issue. The issue id in the title (`<PREFIX>-<n>`) is what lets Linear's GitHub integration link the PR and move the issue: open PR → In Progress / In Review, merged → Done (the exact mapping is in the team's Git automation settings). A PR without an id is invisible to Linear, so its ticket sits in Todo until someone moves it by hand. If the repo uses GitHub Issues instead, put `Closes #<n>` in the body.

## Discover the project first

Read these once, and use what they say everywhere below instead of assuming:

- `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md`: commands, migration rules, title conventions, release-notes rules, and what local dev is connected to.
- **Default branch** (`<default>` below): `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
- **Package manager** from the lockfile: `bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm. Scripts come from `package.json`, or from the Makefile / justfile in other stacks.
- **CI gates**: `.github/workflows/*.yml` shows which scripts CI runs, and on which paths.
- **Title convention**: `git log --oneline -20 origin/<default>`. Check for Conventional Commits and an issue-id suffix.
- **Issue prefix**: the Linear team key (`list_teams`), or the ids in recent titles.
- **Scratch directory** (`<scratch>` below): if `git check-ignore -q .context/pr/probe.md` succeeds, use `.context/pr/`, otherwise `mktemp -d`. Never use a fixed `/tmp` path, because it collides across worktrees and sessions. Name files `<branch-slug>`, which is the branch name with `/` replaced by `-`.

## Workflow

1. **Read the branch, not your memory of it.**
   ```bash
   git status --short
   git fetch origin <default>
   git log --oneline origin/<default>..HEAD
   git diff --stat origin/<default>...HEAD
   gh pr view --json number,url 2>/dev/null   # a PR may already exist
   ```
   - If a PR already exists, don't create another. Update its body instead (step 9).
   - Uncommitted changes: ask whether they belong in the PR. A hook or tool may auto-commit and push, so check `git log -1 origin/<branch>` before claiming anything is or isn't pushed.
   - If `origin/<default>` already contains the same fix, re-scope honestly or stop and say so. Parallel worktrees and agents often pick up sibling tickets.

2. **Find the issue.** Check these in order and stop at the first hit:
   - the branch name: Linear-generated branches look like `<user>/<prefix>-<n>-<slug>`
   - the commit messages: `git log origin/<default>..HEAD | grep -oiE '<PREFIX>-[0-9]+'`
   - an issue your tooling linked to this worktree, if any
   - the conversation: the user may have named the ticket

   Confirm the issue exists and matches the diff with the Linear MCP's `get_issue`. A branch reused for other work can carry a stale id.

   **No issue found? Always offer to create one before opening the PR.** Don't skip the question, and don't file on your own. Ask once, and include a draft title so the user only has to say yes:
   - **Yes:** file it with the Linear MCP's `save_issue` (the diff you just read counts as the investigation, so the body can cite `file:line` evidence), then use the new id. If the Linear MCP is signed in to a workspace with no team matching this repo, stop and say so. Don't file it somewhere else.
   - **No:** open the PR without an id, and say in the final report that the tracker won't follow it.

3. **Classify every change from the diff.** Read the changed files, not just the stat.
   - **User-facing**: anything an end user, admin, or email recipient can see or feel. That covers UI, copy, routes, emails, permissions, performance they would notice, and data they see.
   - **Developer-facing**: tooling, refactors, deps, tests, docs, and migrations with no visible effect.

4. **Add a release-notes entry, if the repo has a mechanism for one.** Look for `CHANGELOG.md`, `.changeset/`, an in-app "What's New" data file, or a rule in `AGENTS.md`. If there's none, skip this step and say so in Notes. If there is one:
   - **Add an entry** when step 3 found at least one user-facing change. If you're unsure, add one, because a one-line `fix` entry costs almost nothing.
   - **Skip it** when the PR is developer-facing only, or when its user-facing change is still behind a flag or can't be reached yet. The PR that turns the change on gets the entry.
   - **One entry per PR.** If the branch already has one, update it to match the final diff instead of adding a second.
   - Follow [REFERENCE.md → Release notes](REFERENCE.md#release-notes) for the format, date keys, and same-day collisions. Commit the entry on the branch. Add the repo's i18n or format check to step 5 if the entry touches localized files. Quote the entry text in the final report so the user can edit it.

5. **Run the checks you will claim.** List only checks that actually ran and passed, and report failures with their output.
   - Use the repo's script runner (`<pm> run <script>`). Some runners have built-ins that shadow script names. For example, bare `bun test`, `bun build`, and `bun ci` run Bun's own commands, not the `package.json` scripts, and a built-in can exit 0 without running a single gate.
   - Read an aggregate CI script before you run it. If any step mutates the tree (a `--write` formatter, `lint --fix`, a codemod, a comment stripper), never run it on a dirty tree. Commit first, or run the read-only steps one at a time.
   - Run the baseline (typecheck, lint, and tests, under whatever names the repo uses), plus the gates CI runs for the areas the diff touches.

6. **Draft the body** in `<scratch>/<branch-slug>.md` using the template below. Every QA row starts as ⬜.

7. **Run the QA table yourself in the user's browser**, following [Browser QA](#browser-qa) below. Mark each row you ran and saw pass 🤖. Leave every other row ⬜, with the reason in the row. Don't open the PR while a row you ran is failing. Fix it if it's in scope, or stop and tell the user.

8. **Create the PR.** Push only if the branch isn't on the remote yet. Match the repo's title convention. With Conventional Commits, that looks like `feat(billing): retry a failed renewal once (ENG-241)`: the issue id goes at the end in parentheses, and several ids are separated by commas, as in `(ENG-86, ENG-74)`. If the repo squash-merges, the title becomes the commit on `<default>`, so the id also stays in the git history.
   ```bash
   git push -u origin HEAD
   gh pr view --json number,url 2>/dev/null   # a push hook may have opened one already
   gh pr create --base <default> --title "<type(scope): summary (<PREFIX>-<n>)>" --body-file <scratch>/<branch-slug>.md
   ```
   If a hook opened a PR on push, fix that PR with `gh pr edit` instead of creating a second one.

   **Partial work** (the ticket should stay open after this merges): leave the id out of the title and write `Part of <PREFIX>-<n>` in the body. A non-closing phrase like this links the PR without moving the issue to Done. The branch name links the PR too, so a `<prefix>-<n>-…` branch will still move the issue. Point that out to the user if it matters.

9. **Updating an existing PR:** read the body with `gh pr view <n> --json title,body` and replace only the human-authored part. Keep auto-generated blocks (bot summaries in `<!-- … -->` markers) intact. Keep every ✅ and 🤖 on a QA row that still applies. Reset a row to ⬜ only if its behavior changed since it was marked, then rerun step 7 for new and reset rows. Then run `gh pr edit <n> --body-file <file>`. If the title has no issue id, run step 2 and add the id with `gh pr edit <n> --title "…"`. If the user-facing changes have changed, rerun step 4 so the release-notes entry still matches the diff.

10. **Report:**
    - the PR URL
    - the linked issue, or that there isn't one and why
    - the release-notes entry and its text, or why there's none
    - the checks that ran
    - the QA split: how many rows are 🤖 and how many ⬜, and which account ran them
    - every write made to the logged-in user's own data
    - the dev server URL, left running so the user can do the ⬜ rows
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

🤖 Claude ran it on local dev as `<session email>` · ⬜ yours to test · ✅ you tested it

| ✓ | Where | Do | Expect |
| --- | --- | --- | --- |
| 🤖 | <route / screen> | <action> | <observable result> |
| ⬜ | <route / screen> | <action> _Left for you: <reason>._ | <observable result> |

## Notes
- Release notes: <added `<entry>` | none — <why: developer-facing only / behind a flag / no mechanism>>
- Browser QA: <what local dev was connected to; writes Claude made to `<session email>`'s own data and uploaded storage keys — or "read-only">
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
2. **Open the user's real Chrome.** Load the `claude-in-chrome` skill, then open a new tab. Don't reuse the user's existing tabs. If the extension isn't connected, ask the user. Don't fall back to a headless browser, because it has no logged-in session.
3. **Check who is logged in.** Call the auth library's session endpoint from the page with the `javascript_tool`. Return only the identity fields. The full response can include the session token, which must never land in the transcript or the PR. With Better Auth, for example:
   ```js
   const s = await fetch('/api/auth/get-session').then(r => r.json()); s && { email: s.user.email, role: s.user.role, impersonatedBy: s.session.impersonatedBy }
   ```
   With Auth.js, use `/api/auth/session` and return `s?.user?.email`.
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

- **The issue id goes in the title**, as `(<PREFIX>-<n>)` at the end. Mentioning it only in the body doesn't trigger Linear's status automation unless you use a magic word. If there is no issue, offer to create one first (step 2).
- **A user-facing PR ships a release-notes entry** when the repo has a mechanism for one (step 4). Notes names the entry, or explains why there isn't one.
- **The TL;DR is the first section and has exactly the three bullets.** A reviewer should be able to decide how carefully to review from the TL;DR by itself. No file paths, and no detail that belongs in the sections below.
- **Lead with user impact, not implementation.** No file paths in "User-facing changes".
- **The ✓ column holds ⬜, 🤖 or ✅.** Claude sets 🤖 only on rows it ran in the browser and saw pass. The user sets ✅ by editing the PR body. Every row Claude didn't run stays ⬜ and says why. Keep it a table column: GitHub renders `[ ]` in a table cell as literal text and strips `<input>`. Only list items get clickable checkboxes.
- **Never make a browser QA write that reaches beyond the logged-in user's own data** when local dev is connected to production or you can't tell.
- **Every** numbered user-facing change has at least one matching row in "How to verify". Add explicit **regression-check** rows for nearby behavior the change could break, and label them as such in the Do column.
- **QA rows are specific:** the real route (`/settings/profile`, `/admin/users`), how to reach it (role, modal, wizard step, viewport), the exact control with its label as the UI shows it, in the UI's language ("click **Save**"), and the observable result. Never "test that it works".
- **No user-facing changes?** Write "None — developer-facing only." under the heading, and keep a regression row in the QA table for the most exposed surface.
- **Accurate to the current implementation.** Nothing aspirational, and nothing from an earlier iteration of the branch. If a check was skipped or a behavior couldn't be verified locally (it needs prod data, a logged-in session, or a migration), say so in Notes.
- **Migrations:** state in Notes whether one is included and how it gets applied. If the repo's `AGENTS.md` says migrations are applied by hand, never run its push or migrate commands yourself.
