# Writing the deliverable

The deliverable is one self-contained static HTML file, not chat output and not the evidence
markdown. The queries produce the evidence. You produce the judgement. `render-report.sh`
supplies the chrome, so every audit looks the same.

```bash
W=.context/form-fields-audit
<skill-dir>/scripts/query-md.sh ... >> "$W/evidence-<date>.md"     # evidence
<skill-dir>/scripts/id-map.sh                                      # key -> {id, label}
# ...write the triaged fragment to $W/body.html...
<skill-dir>/scripts/render-report.sh "$W/body.html" \
  --id-map "$W/id-map.json" --link 'https://admin.example.com/fields/{id}'
```

Hand the user the `.html` path. Cite the `.md` as the source. Do not present it as the
deliverable. For a right-to-left audience pass `--dir rtl --lang <tag>`.

## The three tiers

Tiers are ordered by **migration risk**, and findings inside a tier by **UX gain**. The order
carries information, so never pad a tier to balance the page.

Tiers are not the match classes in [SKILL.md](SKILL.md) step 2. A match class says how alike two
fields are. A tier says what the fix costs. A Class-A duplicate becomes Tier 2 as soon as its
merge moves a stored answer.

| tier | class | admits | test |
|---|---|---|---|
| 1 | `t1` | config edits, deletions of dead rows | no stored answer is rewritten |
| 2 | `t2` | answer rewrites, condition rewrites | reversible from a backup; one prove-equivalence step |
| 3 | `t3` | structural or product decisions | needs a product owner, not just a migration |

A finding that rewrites even one answer is Tier 2. A finding that changes what the form *asks* is
Tier 3: size it, don't recommend it.

## Every finding carries four assessments

All four, always, in this order. They are what make the page triageable rather than a list.

`Migration` (what has to move) · `Risk` (to current respondents) · `UX gain` · `Reduces` (the
friction or data-quality problem it removes). Colour each one by severity with `as lo`, `as mid`
or `as hi`.

## Markup vocabulary

```html
<div class="wrap">
  <header class="masthead">
    <span class="eyebrow">Snapshot 2026-01-15 · read-only</span>
    <h1>Form Fields Audit</h1>
    <p class="lede">One sentence on what was audited and the headline finding.</p>
    <div class="meta"><span>412 fields</span><span>3 forms</span></div>
  </header>

  <section>
    <div class="stats">
      <div class="stat flag"><b>38</b><span>conditions attached to nothing</span></div>
    </div>
  </section>

  <section>
    <div class="sec-head"><span class="eyebrow">Tier 2</span><h2>Answer rewrites</h2></div>
    <div class="tier t2">
      <div class="tier-head"><span class="tier-tag">Tier 2 · reversible</span><p>What this tier admits.</p></div>
      <div class="find">
        <div class="find-top"><span class="find-id">2.1</span><h3>Short claim, not a topic</h3></div>
        <div class="ev">Measured evidence. Every number in <b>…</b>; field references as #1042.</div>
        <p>Why it matters: the consequence, not a restatement of the evidence.</p>
        <dl class="assess">
          <div class="as mid"><dt>Migration</dt><dd>12k answers, 2 sentinels</dd></div>
          <div class="as mid"><dt>Risk</dt><dd>Moderate: it triggers conditions</dd></div>
          <div class="as hi"><dt>UX gain</dt><dd>Highest in the form</dd></div>
          <div class="as mid"><dt>Reduces</dt><dd>Bounded 0–100 at entry</dd></div>
        </dl>
      </div>
    </div>
  </section>
</div>
```

Other blocks: `.stats` > `.stat` (`.flag` or `.warn` colours the figure) for the opening band,
only for figures that are genuinely the point. Use `.tbl-scroll` > `table` for any table
(`td.num` for numbers), `.note` for method and caveats, `.eyebrow` for section kickers, and a
closing `footer`.

## Ids must be clickable

The page is read by an admin who needs to *check* the lists, not take them on trust.

**Write every field reference as `#<key>`**, for example `#1042`. With `--id-map` and `--link`,
`render-report.sh` rewrites each one into `<a class="fid" href="…">` with the field's label as
the tooltip. It never touches text inside a tag or inside an existing anchor. A bare `1042` is
not linked, so write `#1042` in table cells too. The default token pattern is digits. Change it
with `--id-pattern` when keys are slugs. If links were requested and the map is missing, empty or
malformed, the script fails rather than rendering bare ids that look complete.

**Every finding that claims a count owns a list.** Put the ids behind a disclosure, so the claim
can be checked without bloating the page:

```html
<details class="ids"><summary>110 number fields with no min and no max</summary>
  <div class="chips">#1201 #1205 #1260 …</div>
  <p class="ids-note">Each opens on its admin page, where the bounds are set.</p>
</details>
```

If the set is too large to list (hundreds) or has no admin page (conditions often have none),
skip the chips and put the regenerating SQL in `.ids-note`. Never state a count that cannot be
reproduced.

## Rules

- **Mark text direction.** When a label's script runs in the other direction from the page
  (right-to-left labels on a left-to-right page, or the reverse), wrap it in `<bdi>` or a
  `<span dir="…">`. Unmarked mixed-direction text reorders punctuation and reads as broken.
- **Evidence before prose.** The `.ev` block states what was measured. The paragraph says what
  follows from it. Never assert a count you did not query.
- **Name the counter-example.** Include at least one candidate you checked and *rejected*, such
  as an identical label that turned out to be asked about two different people. A page with no
  rejected findings reads as unverified.
- **Date the figures.** Answers grow with every signup. State the snapshot date and present
  counts as orders of magnitude, not fixed values.
- **Close the caveats section** with the execution blockers you found in Step 0: which type
  transitions the app permits, and whether a type change destroys option metadata.
- **The title is a name, not a caption:** `Form Fields Audit`, not `An audit of the fields table`.
