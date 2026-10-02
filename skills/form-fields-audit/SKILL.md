---
name: form-fields-audit
description: Audit a dynamic-form schema (a table of configurable fields or questions plus a table of stored answers) for duplicate, dead, wrongly typed and under-validated fields, then write a triaged HTML report and a reviewed, never-executed migration plan. Read-only against the database. Use when asked to find duplicate or redundant form fields or questions, reduce form friction, delete unused fields, decide which fields can be merged or consolidated, convert a field's type (for example a year dropdown to a number input), find dead or tautological visibility conditions, or add missing validation (min/max, pattern, required, date rules) in a form builder or survey engine.
---

# Form fields audit

Finds what can be deleted, merged, retyped and validated in a configurable form, and writes a
report a human can act on. The method works for any schema. The SQL patterns are PostgreSQL.

**Read-only.** Every query runs through a read-only role (`AUDIT_DATABASE_URL`) in a read-only
session. Never use the app's read-write URL, never write, never run the migrations you draft.
Approving the plan does not authorize you to execute it.

## Quick start

```bash
W=.context/form-fields-audit; mkdir -p "$W"
git check-ignore -q "$W/x" || echo "NOT ignored: add .context/ to .gitignore, or use W=\$(mktemp -d)"
# Step 0 first: write $W/schema-map.md and $W/audit.env (REFERENCE.md, Step 0)
<skill-dir>/scripts/query-md.sh unanswered.sql --title "## 2. Unanswered fields" >> "$W/evidence-$(date +%F).md"
<skill-dir>/scripts/pair-overlap.sh 1042 1187              # keep 1042, drop 1187?
<skill-dir>/scripts/id-map.sh                              # key -> {id,label}, for clickable ids
<skill-dir>/scripts/render-report.sh "$W/body.html" \
  --id-map "$W/id-map.json" --link 'https://admin.example.com/fields/{id}'
```

The evidence `.md` is working material. **The deliverable is the triaged HTML report.** Hand the
user its path and put only the headline numbers in chat.

## Workflow

0. **Map the schema before any query.** Find the fields table, the answers table, where options
   live, how fields attach to forms or steps, and everything that references a field
   (conditions, rules, templates, exports, caches, triggers). Write it to `schema-map.md` and
   the script config to `audit.env`. The checklist is in [REFERENCE.md](REFERENCE.md#step-0-map-the-schema).
   Read the app code that defines field types, the condition evaluator and type-change handling.
   The database does not show those rules by itself.
1. **Collect evidence.** Adapt the [query patterns](REFERENCE.md#query-patterns) to the map and
   append each result to `evidence-<date>.md` with `query-md.sh`. Lead your reply with the
   numbers that decide scope: total fields, conditions attached to nothing, exact-duplicate label
   groups, the enforcement-gap ratios, and required fields in the shared flow.
2. **Classify every consolidation candidate into a match class** before proposing anything. A
   match class says how alike two fields are. It is not a report tier, which says how risky the
   migration is. A Class-A duplicate whose merge rewrites answers is still Tier 2.
   - **Class A**: the same field. Delete the duplicate.
   - **Class B**: not identical but consolidatable (two spellings, a select and a number asking
     the same thing, six fields that are really one address).
   - **Class C**: genuinely different, merged only to cut friction. That is a product decision,
     not cleanup. Flag it and size it. Do not assume it.
3. **Verify every Class-A pair with `pair-overlap.sh <keep_key> <drop_key>`** before calling it
   a duplicate. A matching label is not enough. See the trap below.
4. **Write the migration plan per field** using the four cases in
   [REFERENCE.md](REFERENCE.md#migration-cases): delete unused, merge then delete, retype,
   backfill enforcement. Run the deletion checklist for every field you would remove.
5. **Write the report.** Build the findings fragment per [DELIVERABLE.md](DELIVERABLE.md): three tiers
   ordered by migration risk, four assessments on every finding, and at least one candidate you
   checked and rejected. Then run `render-report.sh body.html` and give the user the `.html` path.
6. **Never execute.** Hand over reviewed SQL files with backups, preflight counts, postflight
   checks and a rollback recipe. Someone with write access runs them.

## The false-positive trap

Identical labels are often **different entities**, because a form asks the same question about
several people or things: "Last name" for the applicant, the father and the spouse, or "City"
for home and for work. Merging those destroys data.

Decide from the **overlap of respondents**, not from the label:

| respondent overlap | meaning | action |
|---|---|---|
| ≈ 0 | disjoint eras of the form: nobody answered both | near-lossless merge |
| ≈ min(count), labels differ | true duplicate: one fact asked twice, two ways | drop the redundant side |
| large, both sides large, same label | different entities | **do not merge** |
| anything in between | mixed | read sample answers from both sides |

Count distinct respondents (people), not submissions. If the respondent column is a submission
id, two fields on different forms never overlap even when the same person answered both.

## Type-conversion rule

Convert a numeric select to a number input when the options are pure numerics **and** (there are
more than 25 of them **or** the domain is continuous: money, grades, years, ages).

Keep the select when the list is short and discrete (about 15 or fewer). A 12-option dropdown is
*less* friction on a phone than a keyboard.

Sentinel options such as "None", "No income", "Over 20,000", "20+" or "11 or more" always carry
meaning. Preserve them explicitly, as a separate flag or as `null` with a documented meaning.
Never silently clamp them to a boundary number.

Add `min`/`max` on every conversion, for example years 1900 to 2100, percentages 0 to 100, and
money from 0 to a ceiling that the stored answers support.

## What blocks execution

- **App-level type rules.** Form builders often allow only some type transitions (for example
  only "collapse to free text"). If the target type is not allowed, every retype is a
  hand-written SQL migration, or the transition rule has to be widened first. Find the rule in
  code during Step 0.
- **Retyping can destroy option metadata.** Many apps clean a field's type-specific config on a
  type change, which deletes the option-id-to-label map you need to read old answers. Snapshot
  the options into the backup table before you flip the type.
- **Hidden side effects.** Direct SQL can bypass the app's cache invalidation. Templates can
  reference fields by key with no foreign key. Triggers can maintain denormalized copies of
  answers. All of these are on the deletion checklist.

## Large answers tables

Answers tables are usually the biggest table in the app. Aggregate them once per query
(`GROUP BY` field), sample free text with `LATERAL (... LIMIT 300)`, and never define the
answers table as a CTE that is referenced twice, because it may be materialized. The role's
default statement timeout may be seconds, so `_db.sh` raises it (`STATEMENT_TIMEOUT`, default
290s). Run the heavy queries once and keep the evidence file.

## Reference

- [REFERENCE.md](REFERENCE.md): Step 0 schema map and `audit.env`, query patterns, the deletion
  checklist, the four migration cases, and verification queries.
- [DELIVERABLE.md](DELIVERABLE.md): tier model, the four assessments, HTML fragment vocabulary, id links.
- `<skill-dir>/scripts/query-md.sh`: one read-only query to a markdown table.
- `<skill-dir>/scripts/pair-overlap.sh`: respondent overlap and verdict for keep/drop pairs.
- `<skill-dir>/scripts/id-map.sh`: field key to `{id, label}` JSON for report links.
- `<skill-dir>/scripts/render-report.sh`: wraps the fragment in `assets/report-shell.html`
  (`{{TITLE}}`, `{{DESCRIPTION}}`, `{{BODY}}`, `{{LANG}}`, `{{DIR}}`; light/dark, print). Use
  `--dir rtl --lang <tag>` for right-to-left reports. Restyle the shell once, not per report.
