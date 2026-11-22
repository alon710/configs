# codebase-audit

Audits a codebase, or one part of it, for dead code, duplication, inconsistent patterns, over-abstraction, and easy performance, bundle, and cost wins. You get a triaged review where every finding has `file:line` evidence, and tickets are filed only for the findings you approve.

[skills.sh](https://skills.sh/alon710/configs/codebase-audit) · [SKILL.md](./SKILL.md)

## Install

```bash
npx skills add alon710/configs -s codebase-audit -g
```

## When to use it

- "Audit `src/features/billing` for dead code and duplication."
- "What can we delete? Find cleanup work in this repo."
- "Find the cheap wins: bundle size, N+1 queries, paid API calls."
- "Turn findings 2, 5 and 7 from the audit into tickets."

## What it does

1. Picks a scope (a domain, a component tree, or the diff since the last audit) and the lenses to run.
2. Reads the repo's own rules (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`) and finds its stack, gate commands, and shared primitives.
3. Checks the ledger in `.context/audits/` so findings you declined before do not come back.
4. Runs a read-only scan for leads, then reads every file a lead points at. Leads it cannot confirm are listed as unverified, never as findings.
5. Triages each finding: evidence, recommended change, quantified benefit, risk, effort, priority.
6. Writes the review to `.context/audits/<date>-<scope>.md`, summarizes it, and stops to ask which numbers to file.
7. After you approve, files those findings in the repo's tracker, or hands you ready-to-paste drafts, and records each outcome in the ledger.

## Works with

| Area | Supported |
| --- | --- |
| Stacks | any. The scan's knip, component, and UI checks cover JS/TS front-ends (React, Vue, Svelte, Astro, Tailwind). On other stacks it says what it skipped and still reports name clusters, largest files, fan-out and HTTP calls (Python, Go), paid-service calls, schedules, suppressions, and TODOs. The lens guide has follow-ups for Python, Go, Rust, Ruby, and others. |
| Package managers and runners | bun, pnpm, yarn, npm, uv, poetry, pipenv, pip, cargo, go, bundler, composer, mix; gates from `package.json`, `Makefile`, `justfile`, `Taskfile.yml`, or CI |
| Issue trackers | Linear, Jira, GitHub Issues, GitLab Issues, Azure Boards, Shortcut, ClickUp, Asana, Trello, Notion. Others work through their MCP server or API. |
| Tracker detection | repo docs, then ticket ids in git history, then connected MCP servers and CLIs, then the code host's issues. If it is still unclear, the agent asks once. |
| No tracker connected | drafts with title and body, ready to paste; you send back the ids |

## Requirements

- `git` and `bash` (3.2 or later, so the macOS default works).
- Optional: `rg` (ripgrep) for faster scans; the script falls back to `grep` and `find`.
- Optional: `knip` in a JS repo, or the stack's own dead-code tool (`vulture`, `deptry`, `staticcheck`, `cargo machete`) if the repo already has it. The audit never installs one.
- For filing: the tracker's MCP server or CLI, logged in to the right workspace (`gh`, `glab`, `acli` or `jira`, `az`). Without one, you get drafts.

## Safety

- The audit is read-only. It never edits code and never runs fixers (`knip --fix`, `lint --fix`, formatters).
- Nothing is filed until you pick findings by number. It never creates labels, components, or projects without asking.
- It does not file in a different tracker or team when the right one is missing or a permission check fails.
- Before writing to `.context/`, it checks the directory is git-ignored, and asks before changing `.gitignore`.

## Files

| File | What it holds |
| --- | --- |
| `SKILL.md` | the workflow, the two hard gates, the lenses, triage fields, and the review format |
| `LENSES.md` | per-lens detectors, the evidence bar, and known false positives, per stack |
| `FILING.md` | tracker detection, per-tracker calls, ticket title, body, and acceptance criteria |
| `scripts/audit-scan.sh` | the read-only first-pass scan that prints leads |
