# Reference

## Payload

One JSON file per entity, kept in `.context/verified-data-entry/<key>.json`. `record` is exactly
what the app's schema parses. Everything else is provenance.

```json
{
  "key": "riverside-central",
  "verified": true,
  "allowedSourceHosts": ["riverside-library.example"],
  "internal": ["isActive"],
  "record": {
    "name": "Riverside Central Library",
    "websiteUrl": "https://riverside-library.example/",
    "isActive": false,
    "hours": [
      { "weekday": 1, "opens": "09:00", "closes": "20:00" },
      { "weekday": 7, "opens": null, "closes": null }
    ]
  },
  "provenance": {
    "name": {
      "url": "https://riverside-library.example/about",
      "quote": "Welcome to Riverside Central Library",
      "retrieved": "2026-01-15"
    },
    "websiteUrl": { "url": "https://riverside-library.example/", "quote": "https://riverside-library.example/" },
    "hours.0": {
      "url": "https://riverside-library.example/visit",
      "quote": "Monday 9 am - 8 pm",
      "note": "Monday = weekday 1; times converted to 24-hour"
    },
    "hours.1": {
      "url": "https://riverside-library.example/visit",
      "quote": "Sunday: Closed",
      "note": "Sunday = weekday 7; closed is stored as null opens/closes"
    }
  }
}
```

- `key` is the natural key, which is the upsert conflict target. Never upsert on a generated id.
- `provenance` keys are dotted paths into `record` (`hours.0`, `hours.0.opens`). An entry covers
  that path and everything under it. The most specific entry wins. `validate` fails on an entry
  for a path the record doesn't have.
- `allowedSourceHosts` is the allow-list agreed in the scope questions. An entry matches the host
  and its subdomains, so `gov` matches any `*.gov` host. Sources must be `https`.
- `internal` lists app-internal paths (flags, slugs, ordering) that are not facts and need no
  source. Keep the list short. A fact listed here dodges verification.
- The stored source list is the unique set of provenance URLs. Keep the payload file. It is the
  audit trail for every value and the input for the next fix.

## The template's edit points

`scripts/upsert-template.ts` is a template: copy it into the project's scratch dir and edit it
there.

1. **App schema and target.** `SCHEMA_MODULE` and `SCHEMA_EXPORT` point at the schema the UI
   itself parses this data with (Zod-style `safeParse` and Standard Schema both work), resolved
   from the repo root. Point it at the *read path's* schema. A looser admin-form schema can
   accept what the page then drops. `DB_URL_ENV` names the connection variable.
   `PROD_HOST_PATTERNS` (plus `PROD_DB_HOSTS` at runtime) lists hosts it must never write to.
   Setting `SCHEMA_MODULE` to `null` is a loud last resort.
2. **The write.** `upsert()` runs inside one transaction. Each statement is
   `INSERT ... ON CONFLICT (<natural key>) DO UPDATE`. Child rows are upserted on
   `(parent, child key)`, and children the source no longer lists are deleted, so a fix doesn't
   leave stale rows behind. A child collection absent from the payload is out of scope and is not
   touched. For a partial-scope fix, remove the unscoped columns from each `UPDATE SET` list.
3. **The read-back.** `verify()` selects the stored row and child counts by key. It also answers
   "does this already exist?" before any research.

If the app's driver has no transactions, keep every statement idempotent so a failed run can
simply be re-run. Bind JSON and arrays as text and cast in SQL (`$1::text::jsonb`). A bare
`::jsonb` cast can make a driver JSON-encode an already-encoded string and store a string scalar.

## Stop conditions

Report instead of writing. Include the sources, the conflicting values, and the model change
that would make the data storable.

**Several official versions.** The source publishes different values per sub-unit, period or
category (per branch, per season, per filing status, per program), and the model holds one. Do not
store one variant as universal. If the app picks the best of several variants at runtime ("the
higher of A or B"), the model has to express that too.

**A different basis than the app assumes.** The number is computed on something other than what
the app compares it to: an adjusted, weighted, capped or standardized quantity, net instead of
gross, a different period or unit. A value outside the raw input's possible range (a threshold
of 105 on a 0 to 100 scale) is the tell. A closed form in terms of the app's input exists only if
the transformation is published and linear. Verify it on the source's own worked example.

**Non-official or stale only.** The value appears only on a third-party page, or only on an
official page that is cached, orphaned (not linked from the live site), or for a past period.
Search the live official site again before concluding. Then report it as a gap.

**Not expressible.** The rule needs a construct the model lacks (an interview, a manual review,
"by appointment", an exception committee). If the model has an explicit "not automatically
evaluable" form, use it and label it. Otherwise stop. Do not approximate.

## Modelling traps

- **Scope of a condition.** "A, or B with C. In addition, D." Decide from the source's structure
  whether D gates every route or only some of them. A global prerequisite applies to every route,
  including credential-based ones the source exempts, and wrongly rejects people.
- **Optional sections are claims.** If omitting a section makes the page assert a default ("uses
  the standard table", "no fee"), omit it only after confirming the default really applies.
- **Enums come from the app.** Read allowed values from the app's constants or database enum at
  runtime. A copied list drifts, and a value outside the enum fails on write or disappears on read.
- **Per-entity tables vary.** Two similar entities' tables often differ in one cell. Never fill a
  gap from a sibling.
- **Related rows matter.** Child rows (locations, branches, campuses) often drive structured data,
  maps or search snippets. Omit them only when the source really has none.
- **Automatic side effects.** A new row may appear in a sitemap, search index or feed
  immediately. Create it inactive until the content is complete and confirmed.

## Worked example: a public library's opening hours

Scope answers: entity `riverside-central`. Fields are name, website and weekly hours, but not
events. Allow-list: `riverside-library.example`. Mark verified: yes. Database: dev, confirmed by
host.

1. `verify riverside-central` prints `not found`, so this is an insert.
2. Map: `libraries` (natural key `slug`), `library_hours` (unique `(library_id, weekday)`), the
   page's schema in the app, and a 10-minute cache on the library page. The model has no
   "by appointment" state.
3. Research: the visit page has an hours table where "Mon–Thu" spans four rows with one
   `rowspan`. A summarizer reports it as Monday only, so read the raw HTML. Saturday says "10 am
   – 4 pm (term time)". Sunday says "Closed".
4. Stop check: "term time" means there is a second, holiday schedule. Two official versions, one
   model slot. Stop and report. Offer two options: store term-time hours with a visible
   "term time" note, or extend the model with seasonal schedules. The user picks the note.
5. Build the payload, run `validate`, and show the table: `name` MATCH, the weekday rows
   NORMALIZED (12-hour to 24-hour, day name to weekday number), Sunday NORMALIZED (closed to
   null), `isActive` INTERNAL. The user says yes.
6. `CONFIRM_DB_HOST=<dev host> apply`, then `verify` shows 7 hour rows and `verified: true`.
7. The page shows the old empty state until the cache expires. After 10 minutes every day
   renders, and Sunday shows "Closed", the app's rendering of null, which the source supports.

The same flow fits a published rate or bracket table: the brackets are child rows keyed by
`(table, lower bound)`, each with its own quote. Separate tables per period or filing status are
the "several official versions" stop.
