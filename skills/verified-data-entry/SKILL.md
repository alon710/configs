---
name: verified-data-entry
description: Research a real-world entity's facts (rules, rates, tables, requirements, fees, opening hours) from official primary sources and add or fix it in the app's database, quoting a source for every stored value. Validates the payload with the app's own schema, upserts idempotently on natural keys into the development database only, and checks that the result renders. Use when asked to add an entity whose data must come from official publications, to fill in missing reference data, to correct stored facts against the official source, to enter a published table (rates, brackets, thresholds, schedules), or to mark a record as verified.
---

# Verified data entry

Turns "add X to the app" into rows where every value is quoted from an official source. The rule
is **nothing gets written that isn't quoted from an allowed source**. People act on this data,
so a plausible guess does more harm than a gap.

## Workflow

### 1. Ask the scope questions first

Ask these before researching. Don't guess:

- **Which entity?** Name or natural key. Run `verify <key>` first, because it may already exist.
- **Which fields?** Everything, or a named subset. A fix must touch only those.
- **Which sources count as official?** Agree on an allow-list of hosts: the entity's own domain,
  a government or regulator domain, a standards body. Never a directory, aggregator, maps
  listing, news article, forum or another app's copy.
- **Mark as verified?** Only if every value is quoted from an allowed source.
- **Which database?** It must be the development database. Never production.

### 2. Map the target in the app

Before researching, read the code that stores and shows this entity. Find the tables and their
natural keys, the enum lists (import them from the app's constants rather than copying them), the
schema the UI parses the data with, how a missing value renders, the caches and TTLs in front of
it, and what a new row triggers automatically (sitemap entries, search indexing, notifications).
Write down what the model **cannot** express. That decides several stop conditions.

### 3. Research

- Search, then fetch the source page itself on an allowed host. Do not stop at search snippets.
- **Fetch raw HTML when a table matters** (`curl -sL <url>` and read the `<table>`). Page
  summarizers drop `colspan`/`rowspan`, merge rows and reorder cells, which silently shifts
  values to the wrong row.
- For every value record the URL, a **verbatim quote** in the source's own language, and the
  retrieval date. Put any conversion (units, 24-hour time, translation) in a `note`, never in
  the quote.
- If the source publishes a procedure (steps, a worked formula) rather than a value, derive the
  closed form and check it against the source's own worked example before storing it.
- Check the **basis** of every number: raw or adjusted, gross or net, capped or uncapped, which
  period, which category.

### 4. Stop and report instead of writing

Stop when any of these is true, and report what you found with the sources
(details in [REFERENCE.md](REFERENCE.md#stop-conditions)):

- **Several conflicting official versions** exist (per sub-unit, per period, per category) and
  the model stores one. Do not pick one and store it as universal.
- **The published value is derived or standardized differently from what the app assumes**,
  for example a threshold on an adjusted score where the app compares the raw input.
- **A value appears only on a non-official page**, or only on a cached, orphaned or outdated
  official page (not linked from the live site, or for a past period).
- **The app's model cannot express the rule** without approximating it.

### 5. Confirm with the user

Build the payload ([REFERENCE.md](REFERENCE.md#payload)), run `validate`, and show the user its
table: path, value, status, source. Explain every `NORMALIZED` note. Get an explicit yes before
writing.

| status | meaning |
|---|---|
| `MATCH` | the value appears verbatim in its quote |
| `NORMALIZED` | sourced, converted as the note explains (units, time format, code for a label) |
| `CHECK` | sourced, but the quote doesn't contain the value and no note explains why. Always an error |
| `UNVERIFIED` | no source. An error when `verified` is true |
| `OFF-LIST` | the source host is not on the agreed allow-list. Always an error |
| `NULL` | a null with no source. Check what a missing value renders as |
| `INTERNAL` | app-internal (flags, slugs), listed in `internal`, not a fact |

### 6. Write to the development database

```bash
W=.context/verified-data-entry; mkdir -p "$W"
git check-ignore -q "$W/x" || echo "NOT ignored: ignore .context/, or use W=\$(mktemp -d)"
cp <skill-dir>/scripts/upsert-template.ts "$W/upsert.ts"   # edit its three EDIT blocks
bun "$W/upsert.ts" validate "$W/<key>.json"                # no database access
bun "$W/upsert.ts" verify <key>                            # prints the target host
CONFIRM_DB_HOST=<that host> bun "$W/upsert.ts" apply "$W/<key>.json"
```

Run it from the app's repo root, so `.env` and the app's schema module resolve. `validate` runs
the **app's own schema**. Anything that schema rejects or strips would be silently dropped by the
UI, so a stripped key is an error, not a warning. `apply` prints the target host, refuses
production hosts, refuses unless `CONFIRM_DB_HOST` matches, writes in one transaction, and is
idempotent on natural keys. If `.env` points at production, stop and ask for a dev URL. Do not
edit the guard.

### 7. Verify it renders

Load the page that shows the entity and check each value against the confirmation table. Reads
are often cached: find the TTL or cache tag, and either wait it out or invalidate through the
app's own path, because direct SQL bypasses invalidation. An empty state or a "no data yet"
message where data should be means the stored shape didn't parse at read time. Re-run
`verify <key>` and report what landed.

## Rules

- **Never copy a value from a similar entity**, even when it is probably the same. Per-entity
  tables vary.
- **Null is a claim.** Know what the app renders for a missing value. If null renders as "uses
  the standard", "none" or "closed", storing null asserts that fact and needs a source.
  Distinguish unknown from none.
- **Attach every condition at the scope the source attaches it.** A clause the source puts on
  some alternatives must not become a global prerequisite.
- **Model what the app cannot evaluate as explicitly not automatic**, if the model has such a
  form. Never use the nearest approximation. A wrong "you qualify" is worse than "check manually".
- **Create new entities inactive** until their content is complete, if a new row is published,
  indexed or announced automatically.

## Reference

- [REFERENCE.md](REFERENCE.md): payload shape, template edit points, stop conditions in detail,
  modelling traps, and a worked example (a public library's opening hours).
- `<skill-dir>/scripts/upsert-template.ts`: `validate` / `apply` / `verify` template. JSON payload
  in, app-schema swap point, host printed and confirmed, idempotent upsert.
