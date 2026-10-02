# Reference

## Step 0: map the schema

Write `.context/form-fields-audit/schema-map.md` before running any audit query. Every pattern
below is written against the placeholders in the right column. Fill in what they are in this app.

| question | placeholder |
|---|---|
| Which table holds the configurable fields (questions)? Primary key? | `<fields>`, `<field_pk>` |
| Which id does a human see in the admin UI (a display number, slug or the PK)? | `<field_key>` |
| Where is the label: a column, or a key inside a JSON config column? | `<label>` |
| Type column and its full vocabulary (select, multi-select, number, text, date...) | `<type>` |
| Is there an enabled flag or a soft delete? Or is deletion the only off switch? | `<enabled>` |
| Where do `required`, `min`, `max`, `pattern` and date rules live? | `<required>`, `<min>`, `<max>`, `<pattern>` |
| Options: a separate table, or a JSON array on the field row? Are option ids stable across fields, or generated per field? | `<options>` or `<options_json>`, `<option_label>` |
| Which table holds answers? Its FK to the field, the respondent, the stored value, the timestamp | `<answers>`, `<field_id>`, `<respondent>`, `<value>`, `<answered_at>` |
| How is each type stored in `<value>`? (plain text, JSON `{id,label}` for selects, an array for multi-selects, ISO dates, E.164 phones) | |
| Is `<answers>` unique on `(field, respondent)`? If not, count `DISTINCT <respondent>` | |
| How do fields attach to forms, steps, sections or groups? Is ordering unique per group? | `<field_form_links>`, `<form_id>`, `<forms>` |
| Conditions or visibility rules: the trigger field, the operator, the listed values, and every table that attaches a condition to something (the one that gates fields is `<field_condition_links>`) | `<conditions>`, `<condition_field>`, `<operator>`, `<condition_id>`, `<condition_links_N>` |
| Which part of the form does every respondent see (onboarding, profile, a shared first step)? | `<shared_flow>` |
| What else references a field: export column configs, external field mappings, templates that use `{{field_<key>}}`-style variables, analytics, BI views | |
| Triggers on `<answers>`, and denormalized tables they maintain (often with no FK) | |
| In code: allowed type transitions, the config clean-up that runs on a type change, how a stored answer of the wrong shape is rendered, what happens to the answers of a field that becomes hidden, the condition evaluator, the caches in front of field definitions | |
| Scale: row counts of `<fields>` and `<answers>`, and the indexes on `<answers>` | |

Then write `.context/form-fields-audit/audit.env` for the scripts. Plain `KEY=value` lines, no
inline comments. Variables already set in the environment win, so you can keep the URL out of
the file:

```bash
# a read-only role; better set in the environment than stored here
AUDIT_DATABASE_URL=postgres://readonly_role@db.example.com:5432/app
FIELDS_TABLE=form_fields
FIELD_PK=id
FIELD_KEY=ref
FIELD_LABEL="config->>'label'"
ANSWERS_TABLE=field_answers
ANSWER_FIELD_FK=field_id
ANSWER_RESPONDENT=user_id
ANSWERS_FILTER="deleted_at IS NULL"
STATEMENT_TIMEOUT=290s
```

`FIELD_LABEL` and `ANSWERS_FILTER` are SQL expressions. Every other value must be a plain
identifier, and the scripts refuse anything else.

### Traps to look for while mapping

- The label, `required` flag and validation rules may not be columns at all. They are often
  keys inside one JSON config column.
- There may be **no soft delete**. An enabled flag may be the only on/off switch, and deleting a
  field cascades into its answers.
- Option ids generated per field (random UUIDs) are unrelated across fields. A merge then needs
  an explicit option map, because swapping the field id leaves answers pointing at option ids
  the survivor does not have.
- A single text `<value>` column holding JSON for some types and plain text for others means
  every query has to branch on `<type>`.
- If the answers table is unique on `(field, respondent)`, its row count per field equals
  distinct respondents. Confirm that before relying on it.

### Connecting read-only

Use a dedicated read-only role and refuse to fall back to the app's URL. `_db.sh` also sets
`default_transaction_read_only = on` for every session. That guards against accidents, but it is
not a security boundary; the role is. Some connection poolers reject startup options such as
`PGOPTIONS`, so the timeout is set with a `SET` statement, and psql runs with `-q` so the
command tags do not end up in the output.

## Query patterns

Each pattern is a template. Replace the placeholders, run it with
`<skill-dir>/scripts/query-md.sh`, and append the output to the evidence file under a numbered
heading. The normalized label used throughout is:

```sql
lower(btrim(regexp_replace(regexp_replace(<label>, '<[^>]*>', '', 'g'), '[[:space:]]+', ' ', 'g')))
```

### 1. Inventory

```sql
SELECT <type> AS type, count(*) AS fields,
       count(*) FILTER (WHERE NOT <enabled>) AS disabled
FROM <fields> GROUP BY 1 ORDER BY 2 DESC;
```

### 2. Unanswered and unreferenced fields

No recent answers **and** no references means a free deletion (after the deletion checklist).

```sql
WITH a AS (SELECT <field_id> AS pk, count(DISTINCT <respondent>) AS n, max(<answered_at>) AS last_at
           FROM <answers> GROUP BY 1)
SELECT f.<field_key>, left(f.<label>, 60) AS label, f.<type> AS type,
       COALESCE(a.n, 0) AS respondents, a.last_at,
       EXISTS (SELECT 1 FROM <conditions> c WHERE c.<condition_field> = f.<field_pk>) AS triggers_condition,
       EXISTS (SELECT 1 FROM <field_condition_links> l WHERE l.<field_id> = f.<field_pk>) AS is_gated
FROM <fields> f LEFT JOIN a ON a.pk = f.<field_pk>
WHERE COALESCE(a.n, 0) = 0 OR a.last_at < now() - interval '90 days'
ORDER BY respondents, f.<field_key>;
```

### 3. Fields that live only on retired forms

A field whose every form is inactive, unpublished or past its end date is the cheapest thing to
retire.

```sql
SELECT f.<field_key>, left(f.<label>, 60) AS label, count(*) AS forms
FROM <fields> f JOIN <field_form_links> l ON l.<field_id> = f.<field_pk>
GROUP BY f.<field_pk>, f.<field_key>, f.<label>
HAVING bool_and(NOT EXISTS (SELECT 1 FROM <forms> fm WHERE fm.id = l.<form_id> AND <form is live>));
```

### 4. Exact-duplicate labels (Class A candidates)

Candidates only. Every group goes through `pair-overlap.sh` before anything is called a duplicate.

```sql
WITH n AS (SELECT <field_pk> AS pk, <field_key> AS fkey, <type> AS type, <normalized label> AS norm
           FROM <fields>),
     a AS (SELECT <field_id> AS pk, count(DISTINCT <respondent>) AS n FROM <answers> GROUP BY 1)
SELECT n.norm AS label, count(*) AS fields, string_agg(DISTINCT n.type::text, '/') AS types,
       string_agg(n.fkey::text, ',' ORDER BY n.fkey) AS keys, sum(COALESCE(a.n, 0)) AS respondents
FROM n LEFT JOIN a USING (pk)
GROUP BY n.norm HAVING count(*) > 1
ORDER BY fields DESC, respondents DESC;
```

### 5. Near-duplicate labels (Class B candidates)

Needs the `pg_trgm` extension, and a read-only role cannot install it
(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`). Without it, export the normalized labels
and compare them offline. The self-join is quadratic, which is fine for a few thousand fields.

```sql
WITH n AS (SELECT <field_key> AS fkey, <normalized label> AS norm FROM <fields>)
SELECT x.fkey AS key_a, left(x.norm, 48) AS label_a, y.fkey AS key_b, left(y.norm, 48) AS label_b,
       round(similarity(x.norm, y.norm)::numeric, 2) AS sim
FROM n x JOIN n y ON x.fkey < y.fkey
WHERE x.norm <> y.norm AND length(x.norm) > 8 AND length(y.norm) > 8
  AND similarity(x.norm, y.norm) > 0.80
ORDER BY sim DESC LIMIT 150;
```

### 6. Selects whose options are all numbers

Apply the type-conversion rule in SKILL.md. `non_numeric` counts the sentinels, which must be
preserved. A continuous domain (money, grades, years) cannot be detected from counts. Read the
label.

```sql
WITH o AS (
  SELECT f.<field_pk> AS pk, f.<field_key> AS fkey, left(f.<label>, 55) AS label, count(*) AS options,
         count(*) FILTER (WHERE btrim(o.<option_label>) !~ '^[0-9]+$') AS non_numeric,
         bool_and(btrim(o.<option_label>) ~ '^[0-9]{4}$') AS all_years
  FROM <fields> f JOIN <options> o ON o.<field_id> = f.<field_pk>
  WHERE f.<type> IN (<select types>)
  GROUP BY 1, 2, 3)
SELECT fkey, label, options, non_numeric, all_years,
       CASE WHEN all_years THEN 'number input, bounded as years'
            WHEN options > 25 THEN 'number input, set min/max'
            ELSE 'keep the select (short list)' END AS recommendation
FROM o
WHERE options - non_numeric >= 4 AND non_numeric <= 2
ORDER BY options DESC;
```

Options as a JSON array on the field row: replace the join with
`FROM <fields> f, LATERAL jsonb_array_elements(f.<options_json>) e` and use `e->>'label'`.

### 7. Free-text fields holding typed data

Samples up to 300 non-empty answers per field. A high share means the field has the wrong type
and enforces nothing. Add the identifier formats of the app's locale (national ids, postal
codes, local phone formats).

```sql
WITH t AS (SELECT <field_pk> AS pk, <field_key> AS fkey, left(<label>, 50) AS label
           FROM <fields> WHERE <type> IN (<free-text types>)),
     s AS (SELECT t.fkey, t.label, x.v
           FROM t JOIN LATERAL (SELECT btrim(<value>) AS v FROM <answers>
                                WHERE <field_id> = t.pk AND btrim(<value>) <> '' LIMIT 300) x ON true)
SELECT fkey, label, count(*) AS sampled,
  round(100.0 * count(*) FILTER (WHERE v ~ '^-?[0-9]+([.,][0-9]+)?$') / count(*)) AS pct_numeric,
  round(100.0 * count(*) FILTER (WHERE v ~ '^[0-9]{4}$') / count(*)) AS pct_year,
  round(100.0 * count(*) FILTER (WHERE v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') / count(*)) AS pct_email,
  round(100.0 * count(*) FILTER (WHERE v ~ '^\+?[0-9][0-9 ()-]{6,}$') / count(*)) AS pct_phone,
  round(100.0 * count(*) FILTER (WHERE v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}') / count(*)) AS pct_date
FROM s GROUP BY 1, 2 HAVING count(*) >= 20
ORDER BY pct_numeric DESC;
```

### 8. Enforcement-gap ratios

Report each gap next to its covered count. The ratio says whether enforcement is the norm or the
exception. A match-anything pattern (`.*`) counts as no pattern.

```sql
SELECT 'number without min AND max' AS gap, count(*) AS n FROM <fields> WHERE <type> = '<number>' AND (<min> IS NULL OR <max> IS NULL)
UNION ALL SELECT 'number with both bounds', count(*) FROM <fields> WHERE <type> = '<number>' AND <min> IS NOT NULL AND <max> IS NOT NULL
UNION ALL SELECT 'text with no pattern', count(*) FROM <fields> WHERE <type> IN (<text types>) AND COALESCE(<pattern>, '') IN ('', '.*')
UNION ALL SELECT 'text with a pattern', count(*) FROM <fields> WHERE <type> IN (<text types>) AND COALESCE(<pattern>, '') NOT IN ('', '.*')
UNION ALL SELECT 'date with no date rule', count(*) FROM <fields> WHERE <type> = '<date>' AND <no past/future/min-age rule>
UNION ALL SELECT 'options left on a non-select type', count(*) FROM <fields> WHERE <has options> AND <type> NOT IN (<select types>)
UNION ALL SELECT 'required, enabled, in the shared flow', count(*) FROM <fields> WHERE <enabled> AND <required> AND <shared_flow>;
```

Also count rows carrying dead legacy config keys left over from an old import.

### 9. Conditions attached to nothing

Define "attached" **once**, as a `UNION` over every table that attaches a condition to something
(fields, forms, documents, condition groups), and reuse that exact CTE in patterns 9 to 11.
Queries that each define it slightly differently silently disagree about which conditions are
live. `UNION` (not `UNION ALL`) counts a condition attached twice once.

```sql
WITH attached AS (SELECT <condition_id> AS id FROM <condition_links_1>
                  UNION SELECT <condition_id> FROM <condition_links_2>
                  UNION SELECT <condition_id> FROM <condition_links_3>)
SELECT count(*) AS conditions,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM attached a WHERE a.id = c.id)) AS attached_to_nothing
FROM <conditions> c;
```

Use `NOT EXISTS`, not `NOT IN`. One `NULL` in the subquery makes `NOT IN` match nothing.

### 10. Selectivity of set conditions

`in` and `not_in` are complements, so the same list means opposite things. An empty `in` matches
nothing. An empty `not_in` matches everything. The app's condition evaluator is the reference:
read it before classifying.

```sql
WITH attached AS (...),
     j AS (SELECT c.<operator> AS op, <number of listed values> AS listed,
                  (SELECT count(*) FROM <options> o WHERE o.<field_id> = c.<condition_field>) AS opts
           FROM <conditions> c JOIN attached a ON a.id = c.id
           WHERE c.<operator> IN ('in', 'not_in'))
SELECT count(*) AS set_conditions,
  count(*) FILTER (WHERE op = 'in'     AND listed = 0)    AS in_empty_never_true,
  count(*) FILTER (WHERE op = 'in'     AND listed = opts) AS in_all_always_true,
  count(*) FILTER (WHERE op = 'not_in' AND listed = opts) AS not_in_all_never_true,
  count(*) FILTER (WHERE op = 'not_in' AND listed = 0)    AS not_in_empty_always_true,
  count(*) FILTER (WHERE op = 'in' AND listed > opts / 2.0 AND listed < opts) AS in_over_half
FROM j;
```

An `in` that lists most of the options should usually become `not_in` the rest, because an `in`
list silently excludes every option added later. That inversion is only equivalent for
single-choice fields. For multi-choice, "any of S" is not the complement of "any of the rest".

### 11. Conditions listing option ids that no longer exist

Do **not** restrict this to trigger fields that still have options. A field retyped away from a
select loses its options entirely, which is exactly when its conditions go dead. Count the
operators separately. A dead `in` can never fire. A dead `not_in` excludes nothing and is always
true. A partially stale `not_in` still works: that is cruft, not a defect.

```sql
WITH attached AS (...),
     z AS (SELECT c.<operator> AS op, <number of listed values> AS listed,
                  (SELECT count(*) FROM <unnest listed values> v
                   WHERE NOT EXISTS (SELECT 1 FROM <options> o
                                     WHERE o.<field_id> = c.<condition_field> AND o.id::text = v::text)) AS bad
           FROM <conditions> c JOIN attached a ON a.id = c.id
           WHERE c.<operator> IN ('in', 'not_in') AND <number of listed values> > 0)
SELECT count(*) FILTER (WHERE op = 'in'     AND bad = listed)              AS in_never_matches,
       count(*) FILTER (WHERE op = 'in'     AND bad > 0 AND bad < listed)  AS in_partially_dead,
       count(*) FILTER (WHERE op = 'not_in' AND bad = listed)              AS not_in_always_true,
       count(*) FILTER (WHERE op = 'not_in' AND bad > 0 AND bad < listed)  AS not_in_partially_stale,
       count(*) AS checked
FROM z;
```

With JSON-embedded options, use `jsonb_array_elements(COALESCE(f.<options_json>, '[]'))` so a field
with no options still yields a row.

### 12. Shared-flow burden

How many fields every respondent must answer before anything specific to them. This is usually
the headline.

```sql
SELECT count(*) AS fields,
       count(*) FILTER (WHERE <enabled>) AS enabled,
       count(*) FILTER (WHERE <enabled> AND <required>) AS enabled_required,
       count(*) FILTER (WHERE <enabled> AND <required> AND NOT EXISTS (
         SELECT 1 FROM <field_condition_links> l WHERE l.<field_id> = f.<field_pk>)) AS always_shown_required
FROM <fields> f WHERE <shared_flow>;
```

Also list the shared fields in form order (group order, then field order) with type, option count,
required, enabled, respondents, and whether each field triggers or is gated by a condition. Read
it the way a respondent would. A field that triggers or is gated by a condition cannot be deleted
until the condition is repointed.

## Deletion checklist: what a field is wired to

List the foreign keys that point at the fields table and how each behaves on delete:

```sql
SELECT conrelid::regclass AS referencing_table, conname,
       CASE confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
                        WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END AS on_delete
FROM pg_constraint WHERE contype = 'f' AND confrelid = '<fields>'::regclass;
```

Repeat it for `<conditions>`, because deleting a field usually cascades into the conditions it
triggers and from there into what they gate.

Cascades **silently**: answers, conditions the field triggers and their link rows, form links,
export column configs, external field mappings. A cascade is not a plan. Each of these needs a
decision.

Needs manual handling:

- **Denormalized tables kept by triggers**, often with no FK. Delete the answers **first** so
  the trigger prunes its copy. A bare field delete leaves orphans. Find triggers with
  `SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = '<answers>'::regclass;`
  and check whether trigger failures are swallowed into an error table.
- **Templates and text referencing fields by key** (email or document variables like
  `{{field_<key>}}`) have no referential integrity. Grep the code and the template rows for
  every key being removed.
- **Caches.** Direct SQL bypasses the app's cache invalidation. Flush through the app's own path
  (saving any field in the admin UI often does it) or wait out the TTL, and say which in the plan.
- **Ordering.** If `(group, order_index)` is unique, close the gaps after a delete.
- **Analytics, exports and BI views** that select fields by key.

## Migration cases

Every migration file gets: a header listing the affected field keys and the conflict rule → a
backup (a CSV export or a `_backup_<tag>` table created in the same transaction) → a read-only
PREFLIGHT with expected counts → the DML → a POSTFLIGHT → an explicit ROLLBACK recipe.

Pair each SQL file with a runner that is **dry-run by default**: it executes the real SQL inside
a transaction and replaces the final `COMMIT` with `ROLLBACK`, so the counts it reports are
actual statement results. It commits only with an explicit flag. This needs a driver with
transactions (psql, or a session-based driver). HTTP drivers often have none. Follow the
project's conventions for one-off scripts and their naming, and treat the SQL and its runner as
one unit.

### Case 1: delete an unused field

1. Assert zero answers, or answers only from respondents who also answered the survivor.
2. Assert nothing references it: conditions, links, export configs, field mappings.
3. Grep templates for its key.
4. Back up the field row and its answers.
5. Delete from `<answers>` **first**, then from `<fields>`.
6. Close ordering gaps in its group.
7. Flush the app's field cache.

### Case 2: merge B into A, then delete B

1. Classify by respondent overlap (`pair-overlap.sh`). A large overlap with both sides large
   means different entities. Stop.
2. Build an explicit **option map** B→A by label. Labels that do not map go to a review list,
   never to a guess. It is normal for a large share to stay unmapped and be left for respondents
   to re-pick.
3. Back up B's answers in the same transaction. A many-to-one merge cannot be reversed without it.
4. Move only non-conflicting rows. This is required when answers are unique per field and
   respondent:
   ```sql
   UPDATE <answers> SET <field_id> = :a, <value> = <mapped value>
   WHERE <field_id> = :b
     AND NOT EXISTS (SELECT 1 FROM <answers> x WHERE x.<field_id> = :a AND x.<respondent> = <answers>.<respondent>);
   ```
5. State the conflict rule in the header. Default: keep A, and prefer B only where A is empty.
6. Repoint every referrer from B to A (conditions, form links, export configs, field mappings),
   **and rewrite each condition's listed values through the same option map**, because condition
   values embed option ids.
7. Delete B via Case 1. Trigger-maintained copies repopulate from the answers rewrite.

### Case 3: change a field's type

1. Snapshot the options into the backup table **first**. Type-change clean-up may delete them.
2. Convert the answers first and flip the type second. Many renderers coerce a wrongly shaped
   stored answer to empty, so the order decides whether respondents see their data.
3. Select to number: extract the number from the stored option, map sentinels explicitly, and
   write plain digits. Verify the app's numeric parse succeeds on every row, or range conditions
   match nobody.
4. Rewrite that field's conditions from set membership (`in`/`not_in`) to `range`. An orphaned
   condition evaluates false forever, so the field it gates disappears. If the app deletes
   answers to hidden fields, those respondents then lose data as well.
5. Chunk large `UPDATE`s server-side. **Drain by predicate plus `LIMIT`** (update rows that
   still have the old shape until none are left), never keyset by `ORDER BY id` without an index
   that supports it. Draining by predicate is idempotent and restartable. Indexes that include
   `<value>` slow every chunk, so measure one chunk first.
6. Raise `statement_timeout` for the session, and keep each chunk under any driver or proxy
   request ceiling.

### Case 4: backfill enforcement

Config-only updates that add `min`/`max`/`pattern`/date rules. They are safe and reversible, but
**check the stored answers against the new rule first**. A bound that excludes existing data
makes the form unsubmittable for those respondents when validation re-runs on prefilled values.

## Verification queries

```sql
-- orphaned conditions after any retype (must return 0 rows): operator incompatible with field type
SELECT c.id, c.<operator>, f.<type> FROM <conditions> c JOIN <fields> f ON f.<field_pk> = c.<condition_field>
WHERE (f.<type> IN (<select types>) AND c.<operator> NOT IN ('in', 'not_in'))
   OR (f.<type> = '<number>' AND c.<operator> <> 'range')
   OR (f.<type> = '<date>'   AND c.<operator> <> 'date_range')
   OR (f.<type> IN (<types that cannot trigger conditions>));

-- numeric conversion completeness (must be 0)
SELECT count(*) FROM <answers> WHERE <field_id> = :f AND <value> !~ '^-?[0-9]+(\.[0-9]+)?$';

-- merge completeness
SELECT (SELECT count(*) FROM <answers> WHERE <field_id> = :b) AS must_be_zero,
       (SELECT count(*) FROM <answers> WHERE <field_id> = :a) AS survivor_rows;

-- trigger health, if failures are logged
SELECT count(*) FROM <trigger_error_table> WHERE created_at > now() - interval '1 day';
```

Snapshot how many respondents each form's conditions admit, before and after. A condition
rewritten wrong shows up as a cohort silently dropping to zero. Finish with the project's own
test and CI commands.
