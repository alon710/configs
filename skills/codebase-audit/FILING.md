# Filing approved findings

This runs only **after** the user names the findings to file. None of it happens during the audit.

## Pick the tracker

1. If `AGENTS.md`, `CLAUDE.md`, or `CONTRIBUTING.md` names a tracker, team, or project, use it.
2. Otherwise, if Linear MCP tools are available (`list_teams`, `save_issue`), use Linear.
3. Otherwise, if `gh auth status` succeeds and the repo has a GitHub remote, use GitHub Issues.
4. Otherwise, write each issue as ready-to-paste markdown into the audit file and tell the user.

## Resolve the workspace at runtime

Never hard-code a team, project, or label. Discover them, and ask when it is ambiguous.

**Linear**

| | |
|---|---|
| Workspace | confirm the MCP server is connected to the right workspace (`list_teams`). It can be authenticated to a different organization than the repo's. |
| Team | 1 team → use it. Several → pick the one the repo docs name or that matches the repo, else ask. |
| Project | `list_projects({ team })`: 0 → omit; 1 active (`started` or `planned`) → use it and say so; several → ask. Never invent one. |
| Label | `list_issue_labels`: prefer an existing improvement or tech-debt label; use a bug label only for a live defect. Never create a label without asking. |
| State | `Todo`, or `Backlog` if the user says the work is not queued. Check the names with `list_issue_statuses`. |
| Priority | `P1` → 2 (High), `P2` → 3 (Normal), `P3` → 4 (Low). |

**GitHub Issues**

| | |
|---|---|
| Labels | `gh label list`: reuse existing ones (`enhancement`, `tech-debt`, `refactor`). Do not create labels without asking. |
| Priority | use a priority label if the repo has one; otherwise put `Priority: P1` on the first line of the body. |
| Create | `gh issue create --title "<title>" --body-file "$f" --label <label>`, with the body written to `f=$(mktemp)`. A body file avoids shell-quoting damage to code blocks. |

**Search before filing.** Linear: `list_issues({ team, query: '<keywords>' })`. GitHub: `gh issue list --state all --search '<keywords>'`. Link an existing duplicate instead of filing twice.

If creation fails on a plan limit or a permission error, stop and tell the user. Do not retry in a loop or fall back to a different team.

## One issue or several?

- **One issue per finding.** The unit is one reviewable PR.
- **Parent plus subtasks** when a finding has independently landable pieces: a consolidation with N consumers to migrate, or a finding that spans several domains. The parent holds the motivation, the canonical target, and the full call-site inventory. Each subtask is one call site or one domain, independently mergeable and independently revertable.
  - Linear: create the parent with `save_issue`, then each child with `save_issue({ parentId })`.
  - GitHub: use sub-issues if the repo has them enabled; otherwise a tracking issue with a task list (`- [ ] #123`).
- **Never** file a subtask that cannot merge on its own.

## Title

The surface, then the change. It must make sense without the body.

- `Consolidate 4 hand-rolled empty states onto the shared EmptyState`
- `Delete unused UI primitives: completion-badge, section-underline (0 consumers)`
- `Batch the weekly digest email sends through the rate limiter instead of a per-row loop`

Not: `Cleanup`, `Refactor components`, `Improve performance`.

## Body

Write it so another engineer or coding agent can execute it **without repeating the investigation**. The lead paragraph (no heading) says what is wrong, with the user-facing or team-facing impact in **bold**. Then:

```
## Evidence            file:line citations plus the fenced snippet or command output that proves it.
                       Never "grep shows": paste what grep showed.
## Affected files      every file the fix touches, one bullet each, with what changes in it
## Recommended change  the concrete edit, naming the canonical target and the existing pattern
                       it mirrors. Include the superset variant or prop API if consolidating.
## Why now             the quantified benefit: files and lines deleted, call sites collapsed, KB,
                       queries per request, sends per cron run
## Constraints         the repo rules that bind the fix, by the names the repo uses
## Risk                what breaks if the premise is wrong, and how to check before merging
## Out of scope        the adjacent work deliberately left out
## Acceptance criteria checkbox list, see below
```

Send markdown with real newlines, not `\n` escapes.

## Acceptance criteria

Always verifiable, and always including the gates the change needs. Use the repo's real script names:

```
- [ ] `<old component or util>` is deleted and nothing imports it (`<pm> run knip` clean)
- [ ] All N call sites listed above render through `<canonical>`, with no visual change (routes to check: ...)
- [ ] `<pm> run typecheck`, `<pm> run test`, and `<pm> run lint` pass
- [ ] No translation keys orphaned (`<pm> run <i18n-check script>`)
```

Drop the lines that do not apply. Add lens-specific ones: a bundle finding states the expected KB delta and how to measure it; a cost finding states the expected call or send count before and after.

## After filing

1. Report each issue's identifier and URL, plus the suggested branch name when the tracker provides one (Linear's `gitBranchName` from `get_issue`).
2. Append the outcome to the audit file in the ledger: each finding number → `filed as <id>` or `declined by user`, so the next audit skips it.
