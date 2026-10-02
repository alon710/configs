---
name: codebase-audit
description: Audits a codebase, or one domain, directory, or component tree, for dead code, duplicate or inconsistent components, over-abstraction, and easy performance, bundle, and infra-cost wins. Produces an evidence-backed, triaged review for approval first, and files tickets (Linear or GitHub Issues) only after the user picks findings by number. Keeps a ledger so declined findings do not come back. Use when asked to audit or review code for consistency, dead code, duplication, simplification, bundle size, runtime or billing cost, maintainability, or tech debt, to "find cleanup work", "what can we delete", or "make this simpler", or to turn such a review into tickets.
---

# Codebase audit

Find focused, evidence-backed changes that make a codebase **smaller, simpler, faster, cheaper to run, and more consistent**. Consolidate and delete; do not rewrite. Every finding carries `file:line` evidence.

## Two hard gates

1. **Never edit code and never file a ticket during the audit.** The output is a review. Stop and wait for the user to approve specific findings by number. This includes fixer commands (`knip --fix`, `lint --fix`, formatters): an audit runs only read-only tools.
2. **Never report a finding whose source you have not read.** Scanner, grep, and knip output is a lead, not evidence. A lead you could not confirm goes under `## Unverified leads`, never under findings.

## Workflow

1. **Scope it.** Whole-repo audits produce unreadable reviews. Default to one of: a domain or feature directory, one component tree, or the diff since the last audit (`git diff --stat <last-audit-sha>..HEAD`). If the user gave no scope, propose one and the lenses you will run, then proceed. Do not block on an answer.
2. **Learn the repo.** Read `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and any design or architecture doc they link. Note:
   - the package manager, from the lockfile, and the gate scripts in `package.json` (typecheck, lint, test, knip, format, i18n check);
   - the shared primitives: component library directory, formatters, loaders, empty states, table and filter patterns;
   - every rule the repo states by name. Recommendations must reuse patterns that already exist here.
3. **Check the ledger.** Confirm `.context/` is git-ignored, then read prior reviews in `.context/audits/` (see [Ledger](#ledger)). Never re-report a finding the user declined. If one resurfaces, list it under `Deliberately not flagged` as `previously declined (<date>)`.
4. **Run the scan**, then verify each lead by hand:
   ```bash
   mkdir -p .context/audits
   bash <skill-dir>/scripts/audit-scan.sh [scope-path ...] > .context/audits/<date>-<scope>.scan.txt
   ```
   It runs knip (only when installed, and never a `--fix` script), zero-importer components, name-cluster duplication, variant tables, and convention-drift greps for loaders, raw colours, formatting, i18n, RTL, fan-out, heavy deps, paid-service calls, and schedules. It uses ripgrep when available and grep otherwise. Per-lens detectors, the evidence bar, and known false positives are in [LENSES.md](LENSES.md).
5. **Read before recommending.** Open every file a lead points at. A "duplicate" is a duplicate only after you have read both implementations. "Unused" holds only after you have ruled out the dynamic references listed in LENSES.md.
6. **Triage** every confirmed lead with the fields below. Drop the rest silently, or list genuinely uncertain ones as unverified leads, with what it would take to confirm them.
7. **Write the review** (format below) to `.context/audits/<YYYY-MM-DD>-<scope>.md` and summarize it in chat. **Stop.** Ask which numbers to file.
8. **After approval only:** file the approved findings per [FILING.md](FILING.md). Then append each finding's outcome (`filed as <id>` or `declined by user`) to the review file so the next audit skips it.

## Ledger

Reviews and their outcomes live in `.context/audits/`. Before writing there, confirm the directory is git-ignored:

```bash
git check-ignore -q .context/audits/probe.md && echo ignored || echo NOT-ignored
```

If it is not ignored, ask the user whether to add `.context/` to `.gitignore` (shared with the team) or to `.git/info/exclude` (this clone only). That is a repo change, so it waits for an answer like everything else. Meanwhile, write the review to a `mktemp -d` directory and print the path. Never use a fixed `/tmp` path: parallel sessions and worktrees collide there.

## Lenses

Run every lens that applies to the scope. Detectors and false positives: [LENSES.md](LENSES.md).

| Lens | Looking for |
|---|---|
| Dead weight | unused components, variants, exports, utils, tokens, translation keys, dependencies, tables and columns |
| Duplication | near-identical components or logic that should collapse into one with a variant or prop |
| Consistency | the same UI pattern built differently across screens: badges, empty states, loaders, filters, forms, dates |
| Simplicity | over-abstraction: wrappers with one caller, config objects for two cases, generics used once |
| Performance | avoidable client components, request waterfalls, unmemoized heavy work, N+1 queries, unbounded fan-out |
| Bundle | heavy dependencies in client code, modals and editors that are not lazy-loaded, two libraries doing one job |
| Cost | redundant AI calls, unbatched email sends, per-row DB queries, uncached object-storage or API hits, cron frequency |
| DX | patterns that fail silently, a missing shared helper, test gaps around the code a finding changes, docs that drifted from code |

## Rules

- **Consolidation over abstraction.** Prefer deleting code, reusing an existing primitive, or adding a variant. Do not propose new libraries, layers, or architectural patterns. If one seems unavoidable, say why the repo's existing pattern cannot cover it.
- **No large rewrites.** If a finding needs more than about two focused PRs, split it, or justify the size explicitly under `Risk`.
- **Cite the repo's own rule by name** when it constrains the fix, for example its design-token rule, its translation function, its date formatter, or its database driver's transaction limits.
- **Point at an existing example** instead of inventing one: "fold into `Badge`'s `neutral` variant", "mirror the `loading` prop of the shared table".
- **Quantify the benefit** whenever it is countable: files and lines removed, call sites collapsed, KB shaved, queries per request, sends per run. "Cleaner" is not a benefit.
- **Confidence is part of the finding.** Dynamic imports, reflection, translation keys built at runtime, and anything a pipeline or external service references can look dead and not be.
- **Group by pattern.** "9 files hand-roll a spinner" is one finding with 9 call sites, not nine findings.

## Triage (every finding)

| Field | Content |
|---|---|
| Affected code | every `file:line` a fixer will touch |
| Evidence | the snippet, count, or command output that proves it. Paste it; never write "grep shows" |
| Recommended change | the concrete edit, naming the canonical target |
| Benefit | quantified where possible, tied to a lens |
| Risk | `low` / `medium` / `high`, plus what breaks if the premise is wrong |
| Effort | `quick win` (under 1h, isolated) / `small` (one PR) / `large` (needs splitting) |
| Priority | `P1` high benefit and low risk · `P2` worth doing · `P3` opportunistic |

## Review format

```
# Codebase audit: <scope>, <date>
<2-4 sentences: what was scanned, headline numbers, the single biggest win>

## Quick wins               table: # · title · lens · benefit · risk · effort
## Larger refactors         same table
## Findings                 one `### N. Title` per finding with the triage fields,
                            related findings grouped under a shared heading
## Unverified leads         what could not be confirmed, and what it would take
## Deliberately not flagged things that look wrong but are correct here, and why;
                            previously declined findings
```

Then ask which numbers to file. Nothing goes to the tracker until the user answers.
