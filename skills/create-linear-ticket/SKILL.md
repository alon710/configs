---
name: create-linear-ticket
description: File a Linear issue whose description is a real investigation of the codebase — a tested premise, file:line evidence, the root cause, and a concrete suggested fix — rather than a restatement of the request. Resolves the team, issue prefix, labels, statuses, and project from the Linear workspace at file time, and asks once only when that is ambiguous. Use when asked to create, open, or file a Linear ticket, issue, task, or bug, to "write this up in Linear", "open a ticket for this", or to turn a bug report, complaint, or feature request into a Linear issue.
---

# Create a Linear ticket

A ticket is only worth filing once the code has been read. The body must let whoever picks it up start editing files immediately. That means real `file:line` citations, the root cause (not the symptom), and a fix that names the exact edit.

**Never file straight from the prompt.** If the code has not been read yet, investigate first.

**Requires** the Linear MCP server (`list_teams`, `list_issue_labels`, `list_issue_statuses`, `list_projects`, `list_issues`, `save_issue`, `get_issue`). Run from the repo the ticket is about, and cite paths relative to its root.

## Resolve the workspace at file time

Hardcode nothing. Read it all from Linear each time. If anything is ambiguous, ask once, with every open question in that one message.

| | How |
|---|---|
| Team | `list_teams`. One team: use it. Several: prefer the team the repo's `AGENTS.md` / `CLAUDE.md` names, then the one whose key matches the ids in recent commits (command below). Otherwise ask. The team `key` is the issue prefix (`ENG` → `ENG-123`). |
| Wrong workspace | If no team plausibly matches the repo, the MCP is probably signed in to a different account or workspace. Stop and say so. Never file into a guessed team. |
| Label | `list_issue_labels({ team })`. Pick exactly one type label (such as `Bug` / `Feature` / `Improvement`), using the workspace's own names. Skip retired labels (`retiredAt`) and label groups. If the workspace has no type labels, file without one and say so. |
| Status | `list_issue_statuses({ team })`. Default to the team's first `unstarted` status (usually `Todo`). Use a `backlog`-type status when the user says it isn't queued yet. |
| Project | `list_projects({ team })`. None active: omit `project` and don't invent one. Exactly one with an active status (`started` or `planned`): use it, and say so in the report. Several: list their names and ask. Don't guess. |

```bash
git log --oneline -100 | grep -oE '\b[A-Z][A-Z0-9]+-[0-9]+' | sed 's/-[0-9]*$//' | sort | uniq -c | sort -rn   # issue prefixes in use
```

## Workflow

1. **Capture the request verbatim.** Keep the user's wording, in whatever language they wrote it, as a blockquote under `## Original request`. Write everything else in the repo's working language: English unless `AGENTS.md` says otherwise.
2. **Search for duplicates** with `list_issues({ team, query })`, using two or three key terms. If a match exists, link it and stop instead of filing twice. Add a comment to it if the new evidence is worth keeping.
3. **Investigate the code.** Read the repo's `AGENTS.md` / `CLAUDE.md` for its layout. Then find the route, the feature module, the mutation handler, and the data layer and schema. Read the actual functions, not just their names. To jump from a screenshot or a user complaint to the component, grep the visible UI string in the locale or message files, then grep its key. [REFERENCE.md](REFERENCE.md) has the investigation map.
4. **Test the premise, out loud, in the ticket.** The reporter's theory is often wrong. You can confirm it (`## The premise is confirmed`), refute it (`## First: the <X> hypothesis is refuted`), or find that the work is mostly done (`## Survey result: this is mostly already done`). A refuted premise is one of the most valuable things a ticket can contain.
5. **Draft the body** using the skeleton below.
6. **File it** with `save_issue`: the team, title, description, one label, `state`, `priority`, and `project` when one was resolved. Markdown goes in with literal newlines, not `\n` escapes.
7. **Report back** the identifier, the URL, and the `gitBranchName` from `get_issue`, so the user can start the branch.

## Title

Concrete and self-contained: the surface first, then the symptom or goal. It should make sense with no body. Match these:

- `Users table: loading skeleton missing when filtering by a pasted list of emails`
- `Add a payment-provider webhook so customers who pay but close the tab before the return page still get their plan`
- `Date rules: support absolute thresholds (on/after a fixed date), not just offsets from today`

Not: `Fix loading bug`, `Payment issue`, `Improve admin`.

## Body skeleton

Lead paragraph first (no heading): the symptom or the goal, with the user-facing impact in **bold**. Then, using only the sections that apply:

**Bug**

```
## Repro            numbered steps; state the exact precondition that makes it deterministic
## Root cause       file:line + a fenced snippet of the offending code, and why it misbehaves
## Same defect      other call sites with the identical flaw (skip if none)
## Suggested fix    the exact edit, at a named line, ideally mirroring a guard that already exists
## Files            bullet list of every file a fixer will touch
```

**Feature / Improvement**

```
## Original request              blockquote, verbatim, original language kept (skip if paraphrased)
## The premise is confirmed      …or "is refuted", or "Survey result: …". Evidence, with file:line.
## Hard blocker to solve first   anything that makes the obvious approach impossible (skip if none)
## Work items                    numbered, each naming the file it lands in
## <risk section>                idempotency, races, cache, auth — name the real hazard
## Also worth adding             follow-ups deliberately left out of scope
## Existing config               env vars / crons / tables that already exist
```

## Rules

- Every claim about the code carries a `file:line`. Write a claim you couldn't verify as a question, not an assertion.
- The suggested fix must respect the repo's own rules in `AGENTS.md` / `CLAUDE.md`. Read them before you propose the fix. When a rule constrains the fix, cite it by name in the ticket. Typical ones cover a database driver without transaction support, env vars that must be required, cache APIs that only work in some contexts, design tokens, and translating every user-facing string.
- Prefer pointing at an existing pattern over inventing one ("mirror the guard at `:324`", "same dedupe-key pattern as `<table>.<column>` in `<file>:<line>`").
- Don't pad. If the fix is a two-line guard, the ticket is short.
- Don't hand-set a closed status later. When the team has Linear's GitHub integration, a PR titled with `(<PREFIX>-<n>)` links and moves the issue on its own.
