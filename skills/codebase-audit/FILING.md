# Filing approved findings

This runs only **after** the user names the findings to file. None of it happens during the audit.

## Pick the tracker

Detect it in this order. Stop at the first clear answer.

1. **Repo docs.** `AGENTS.md`, `CLAUDE.md` (or the agent's own instructions file), `CONTRIBUTING.md`, the PR/MR template (`.github/pull_request_template.md`, `.gitlab/merge_request_templates/`), README badges. If they name a tracker, team, project, or board, use it.
2. **History.** Ticket ids or links in recent commit messages, branch names, and PR/MR titles (`git log -50 --format=%s`, `git branch -a`). Id forms: Linear, Jira, and YouTrack `ABC-123`; GitHub and GitLab `#123`; Azure Boards `AB#123`; Shortcut `sc-123`; ClickUp `CU-<id>`; Asana, Trello, and Notion links are task, card, and page URLs.
3. **Connected tools.** Tracker MCP servers in this session (Linear, Atlassian/Jira, Asana, ClickUp, Trello, Notion, Shortcut, GitHub), and tracker CLIs on PATH that are logged in (`gh`, `glab`, `jira`, `acli`, `az`).
4. **The code host's own issues**, if they are enabled and in recent use (`gh issue list --limit 5`, `glab issue list`).
5. **Still unclear**, or several candidates: ask the user once, with your best guess, and use the answer for the rest of the run.

`ABC-123` can be Linear, Jira, or YouTrack: tell them apart by which connected tool resolves the id. A connected tool alone is not proof. A Linear MCP in the session does not mean this repo files in Linear.

**No tool for that tracker is connected, or the repo has no tracker:** do not file somewhere else. Write each approved finding as a ready-to-paste draft (title, then body) into the audit file, show the drafts in chat, and say which tool is missing. Ask the user for the ids once they have filed them.

## Resolve the workspace at runtime

Never hard-code a team, project, board, or label. Discover them, and ask when it is ambiguous.

| | |
|---|---|
| Workspace | confirm the connected tool points at the repo's organization, site, or workspace. An MCP server or CLI can be logged in to a different one. |
| Container | the team, project, board, list, or database that holds tickets. 1 → use it. Several → pick the one the repo docs name or that matches the repo, else ask. |
| Grouping | an optional project, epic, milestone, or cycle: 0 → omit; 1 active → use it and say so; several → ask. Never invent one. |
| Type | where the tracker has issue types, use the task, improvement, or chore type. A bug type only for a live defect. |
| Label | prefer an existing improvement or tech-debt label (or tag, or component); use a bug label only for a live defect. Never create a label, tag, component, or field without asking. Where typing a new name creates the label (Jira labels, Azure Boards tags), use only names that already exist. |
| State | the team's to-do state, or the backlog if the user says the work is not queued. Check the state names first. |
| Priority | `P1` → high, `P2` → normal or medium, `P3` → low, in the tracker's own priority field. Never its urgent or highest level. No priority field: use a priority label if the repo has one, otherwise put `Priority: P1` on the first line of the body. |

## Per tracker

Exact calls are given only where they are well established. For anything else, check the tool's `--help`, the MCP server's tool list, or the provider's API docs before calling it.

| Tracker | Container, labels, priority | Search before filing | Create | Parent and children |
|---|---|---|---|---|
| Linear (MCP) | `list_teams`; `list_projects({ team })`, active means `started` or `planned`; `list_issue_labels`; `list_issue_statuses` (`Todo`, or `Backlog`). Priority `P1` → 2 (High), `P2` → 3 (Normal), `P3` → 4 (Low). | `list_issues({ team, query: '<keywords>' })` | `save_issue` (team is required) | parent with `save_issue`, then each child with `save_issue({ parentId })` |
| GitHub Issues (`gh`) | the repo; `gh label list` (reuse `enhancement`, `tech-debt`, `refactor`) | `gh issue list --state all --search '<keywords>'` | `gh issue create --title "<title>" --body-file "$f" --label <label>` | sub-issues if the repo has them enabled; otherwise a tracking issue with a task list (`- [ ] #123`) |
| GitLab Issues (`glab`) | the project; `glab label list`; a priority label if the project has one | `glab issue list --search '<keywords>'`, closed issues included (see `glab issue list --help`) | `glab issue create --title "<title>" --description "$(cat "$f")" --label <label>` | an epic if the group has epics (a paid-tier feature); otherwise a tracking issue with a task list (`- [ ] #123`) |
| Jira (Atlassian MCP, `acli`, `jira`, or the REST API) | the project key and its issue types; existing labels (`GET /rest/api/3/label`) and components (`GET /rest/api/3/project/<key>/components`); priority from the project's scheme (`High` / `Medium` / `Low` by default) | JQL: `project = <KEY> AND text ~ "<keywords>"` | an issue with `project`, `issuetype`, `summary`, `description`, `labels`, `components`, `priority` | an epic with child issues (each child's `parent` is the epic key), or a task with sub-tasks (each sub-task's `parent` is the task key). Use the issue types the project has; Jira Data Center and older setups link epics through the Epic Link field. |
| Azure Boards (`az boards`) | organization, project, area and iteration path; tags in `System.Tags`; priority in `Microsoft.VSTS.Common.Priority` (1 is highest; check the team's convention) | `az boards query --wiql "SELECT [System.Id], [System.Title] FROM workitems WHERE [System.TeamProject] = @project AND [System.Title] CONTAINS '<keyword>'"` | `az boards work-item create --type <type> --title "<title>" --description "<html>"`, with tags and priority set through `--fields` | `az boards work-item relation add --id <child> --relation-type parent --target-id <parent>` |
| Shortcut (MCP or REST API) | the team, its workflow and states, existing labels; story type `chore` for cleanup, `bug` for a live defect | a story search with the keywords | a story; the description takes markdown | an epic with one story per piece (`epic_id` on each story) |
| ClickUp (MCP or API) | the space, folder, and list that hold tasks; existing tags; priority 2 (high), 3 (normal), 4 (low) | the MCP's search if it has one, else the list's tasks matched by name | a task in that list | subtasks (create each with `parent` set to the parent task's id), or a checklist on one task |
| Asana (MCP or API) | workspace, project, and section; existing tags; a priority custom field if the project has one | task search in the workspace (the API's search needs a paid plan), else the project's tasks matched by name | a task in that project | subtasks of the parent task |
| Trello (MCP or REST API) | the board and its backlog or to-do list; the board's existing labels; priority as a label if the board has one | a card search with the keywords, limited to that board | a card in that list; the description takes markdown | no sub-cards: one card per finding, with a checklist for the pieces |
| Notion (MCP) | the tasks database the team uses, and its property names (title, status, priority, and tags differ per database) | the MCP's search, or a query on that database by title | a page in that database, with its properties set | sub-items if the database has them turned on; otherwise a relation property, or a to-do list on the parent page |
| Other (YouTrack, …) | apply the rules above through its MCP or API; check its docs for exact calls | | | |

**Search before filing.** Search open and closed tickets with the finding's key terms (the component, file, or pattern). Link an existing duplicate instead of filing twice.

**Body file.** For a CLI, write the body to `f=$(mktemp)` and pass the file. It avoids shell-quoting damage to code blocks.

**Body format.** Send markdown with real newlines, not `\n` escapes. Some trackers do not render markdown: Jira's REST API v3 takes Atlassian Document Format and v2 takes wiki markup; the Azure Boards description takes HTML by default; Asana's `notes` is plain text and `html_notes` takes a limited HTML subset. Use a tool that converts markdown if its docs say it does. Otherwise convert headings, lists, and code blocks yourself.

If creation fails on a plan limit or a permission error, stop and tell the user. Do not retry in a loop or fall back to a different team, project, or tracker.

## One issue or several?

- **One issue per finding.** The unit is one reviewable PR.
- **Parent plus children** when a finding has independently landable pieces: a consolidation with N consumers to migrate, or a finding that spans several domains. The parent holds the motivation, the canonical target, and the full call-site inventory. Each child is one call site or one domain, independently mergeable and independently revertable. How each tracker links them is in the last column above. A tracker with no hierarchy gets one ticket with a checklist.
- **Never** file a child that cannot merge on its own.

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

## Acceptance criteria

Always verifiable, and always including the gates the change needs. Use the repo's real commands (`<pm> run <script>`, `make <target>`, `just <recipe>`, `cargo …`, `go …`):

```
- [ ] `<old component or util>` is deleted and nothing references it (`<dead-code check>` clean, e.g. `<pm> run knip`)
- [ ] All N call sites listed above go through `<canonical>`, with no visual or behaviour change (routes or commands to check: ...)
- [ ] `<typecheck>`, `<test>`, and `<lint>` pass (e.g. `<pm> run typecheck`, `<pm> run test`, `<pm> run lint`)
- [ ] No translation keys orphaned (`<i18n check>`)
```

Drop the lines that do not apply. Add lens-specific ones: a bundle finding states the expected KB delta and how to measure it; a cost finding states the expected call or send count before and after.

## After filing

1. Report each ticket's id and URL, plus the suggested branch name when the tracker provides one (Linear's `gitBranchName` from `get_issue`). For trackers that link through the id in the branch name (Jira, Shortcut `sc-123`, ClickUp), suggest `<id>-<short-slug>`.
2. Append the outcome to the audit file in the ledger: each finding number → `filed as <id>`, `drafted for the user` (until they send the id), or `declined by user`, so the next audit skips it.
