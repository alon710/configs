# Audit lenses: detectors, evidence bar, false positives

Every command here produces **leads**. Open the file and read it before a lead becomes a finding. `scripts/audit-scan.sh` runs the cheap detectors. The rest are per-lens follow-ups.

Conventions used below:

- `<pm>` is the repo's package manager, from the lockfile: `bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, otherwise npm. Always call scripts as `<pm> run <script>`. Some managers have built-ins that shadow script names: `bun test` runs Bun's own test runner and `bun ci` is not the `ci` script, so neither runs the repo's gates.
- `<src>` is the scope, or the repo's source roots (`src app components features lib ...`, whichever exist).
- Commands use `rg`. Without ripgrep, use `grep -rnE --include='*.tsx' --exclude-dir=node_modules ...` instead.

---

## 1. Dead weight

| Detector | How |
|---|---|
| Unused files, exports, dependencies | `<pm> run knip` if the repo has the script, else `node_modules/.bin/knip`. Read the knip config's `ignore` and `entry` lists first, because a directory it ignores is invisible to it. |
| Unreferenced component file | `bash <component-drilldown-skill>/scripts/find-usages.sh <path>` if that skill is installed, otherwise grep the import specifier. knip can report a dead export but miss a whole file kept alive by one live sibling export. |
| Unused variant | grep the variant key across `<src>`. Zero hits outside the `cva`/`tv` block means a dead variant. |
| Unused design token | list the custom properties in the global stylesheet (`rg -o -- '--[a-z0-9-]+:' <globals.css>`), then grep each name across the theme config and `<src>`. |
| Unused translation key | the repo's i18n validator, if any. Its "unused" output is mostly false positives, because keys are built at runtime (`` t(`status.${value}`) ``). Trust a key only if it is dead in the validator **and** no dynamic construction can reach it. Never mass-delete keys. |
| Dead DB column or table | grep the column name across the schema, queries, and app code. A column that is written and never read is a real finding. The DROP is a separate ticket that ships after the code stops referencing it has deployed. |

**False positives:**

- File-system entrypoints: framework routes and layouts (`page`, `layout`, `route`, `+page`, `pages/`, `routes/`), middleware, server-action files the knip config lists as entries, service workers, web workers.
- Files run by name: CLI and CI scripts, cron targets, migrations, config files a tool loads by convention.
- Anything referenced from outside TypeScript: translation files, SQL, MDX or CMS content, email templates rendered by name, hosting config (cron paths, rewrites), webhook endpoints registered with a third party, tracker or CI configuration.
- Dynamic references: `import()` with a computed path, `import.meta.glob`, string-keyed component registries, dependency-injection containers, auto-imported components (Nuxt, unplugin).

**Evidence bar:** the usage search output showing zero consumers, plus a note naming the dynamic references you ruled out.

---

## 2. Duplication

| Detector | How |
|---|---|
| Near-duplicate names | the scan clusters component files by trailing name token (`*-card`, `*Badge`, `*-empty-state`, `*-form`) and lists the members |
| Parallel variant tables | `rg -l 'cva\(|tv\(' <src>`, then compare the variant tables for overlap |
| Copy-pasted logic | shape scans such as `rg -n 'useEffect\(' <domain> -A6`, and duplicated validation schemas (`rg -n 'z\.object\(' <src> -A8`) |
| Duplicated query | the same filter or `where` clause rebuilt in several handlers instead of one data-access helper |

**Confirm by diffing the two implementations.** Same-shaped markup is not duplication if the semantics differ: a status badge and a plan-tier badge can look alike and still belong to different vocabularies. Check whether the repo docs keep them apart on purpose.

**Recommend** the canonical component, a **superset variant API** (one variant table that covers every case), and a migration list of every consumer. Deleting the losing copy is part of the finding, not a follow-up.

---

## 3. Consistency

Look for the same user-visible pattern implemented differently. First find the sanctioned version in the repo docs or the shared component directory.

- **Loaders**: `rg -n 'animate-spin|Loader2|<Spinner' <src>` outside buttons, inputs, and table rows. Compare with the repo's skeleton or loading primitive.
- **Status colours**: status classes (`bg-success`, `text-destructive`, ...) applied ad hoc through `className` instead of a badge variant. A boolean shown as a badge should use the same pair of colours everywhere.
- **Raw palette and inline colour**: `text-white`, `bg-gray-100`, `from-blue-500`, arbitrary `bg-[#...]`, `style={{ color }}`, where the repo uses semantic design tokens. Email templates, OG-image renderers, and chart configs often need literal colours; those are not findings.
- **Malformed classes**: a botched find-and-replace leaves strings such as `bg-muted/50/50` (a doubled opacity suffix). Tailwind silently drops them, so the element loses its background with no error.
- **Empty states**: hand-rolled "no results" markup instead of the shared empty-state component.
- **Dates, numbers, currency**: `toLocaleDateString`, `toLocaleString(`, or `Intl.NumberFormat` outside the shared formatter module. Inline formatting drifts in locale and timezone.
- **Untranslated strings** (only if the repo has i18n): literal text in JSX or in `placeholder`/`title`/`aria-label` instead of the translation function.
- **Direction** (only if the app supports RTL): physical classes (`ml-`, `pr-`, `left-`, `text-left`, `rounded-l`) where logical ones (`ms-`, `pe-`, `start-`, `text-start`, `rounded-s`) belong.
- **Responsiveness**: viewport breakpoints (`sm:`, `md:`) inside a reusable component that the repo builds with container queries.
- **Tables and filters**: list pages that skip the shared table component or the repo's URL-synced filter pattern.

---

## 4. Simplicity

- A wrapper component, hook, or util with **one** call site that adds no behaviour: inline it.
- A `Record<string, ...>` config or strategy map with two entries: use an `if`.
- A generic type parameter instantiated at exactly one type.
- A service layer that only forwards to the data layer, in a repo that does not otherwise use one.
- Prop drilling more than two levels where a colocated read would do, or a context with a single consumer.
- `useMemo`/`useCallback` around a trivial expression: cost with no benefit.
- Defensive branches for states the types make impossible.

**Detector:** the scan lists the largest files and, for a scoped run, single-importer components. The rest is reading.

---

## 5. Performance (runtime)

- `'use client'` (or the framework's equivalent) on a component whose interactivity could move to a leaf. Public and marketing pages pay the most for this.
- Sequential `await`s in a server handler that could run as one `Promise.all`.
- **Unbounded** fan-out: `rg -n 'Promise\.all\(' <src>`, then check that the array size is bounded. Database drivers, HTTP clients, and provider rate limits fail at high concurrency, so large batches need chunking.
- N+1: an `await` inside `.map` or a `for` loop over rows. Multi-line loops need `rg -nU 'for \([^)]*\) \{[^}]*await '`. Never load a very large table into memory to filter it.
- Outbound `fetch` with no abort signal or timeout.
- Long lists rendered without virtualization.
- Caching: pages or routes forced dynamic where a cached or tagged response would do.

---

## 6. Bundle size

- Heavy dependencies reachable from client code: PDF renderers, rich-text editors, chart and map libraries, fake-data generators, confetti, full date-library locales. Grep the import, then check whether the importing file is client code and whether the import is lazy (`next/dynamic`, `React.lazy`, `import()`).
- Modals, editors, and viewers that load eagerly but open rarely.
- Two libraries doing one job (icons, date maths, class merging, HTTP, validation). The scan checks `package.json` for common pairs.
- Barrel `index.ts` re-exports that pull a whole tree into every importer. Check whether the repo bans them.
- Prove a size claim with the build output or a bundle analyzer when one is configured. Otherwise, label the KB figure as an estimate.

---

## 7. Cost and infra

- **Email**: sends in a loop without the repo's rate limiter or the provider's batch endpoint; a missing idempotency or dedupe key; suppression or bounce lookups done per recipient instead of in one query.
- **AI calls**: a prompt rebuilt on every request instead of cached; oversized context; a model call where a lookup would do; retries without a cap.
- **Database**: per-row queries in a cron; unindexed hot filters (check query statistics such as `pg_stat_statements` if enabled); `SELECT *` on wide tables; aggressive polling intervals.
- **Object storage**: re-uploading derivable assets; missing cache headers; a signed URL generated on every render.
- **Hosting**: cron frequency higher than the job needs; dynamic rendering where static or cached would work; image or proxy routes serving heavy traffic.

**Evidence bar:** the call site plus a volume estimate ("calls per run x runs per day x rows"). A cost claim without a multiplier is a guess. Say so.

---

## 8. DX and maintainability

- Patterns that fail silently: an action wrapper that swallows thrown error messages; a CSS `transform`, `filter`, or `container-type` ancestor that traps `position: fixed` descendants; class strings that compile but match nothing. Check the repo's docs and memory files for ones it has already hit.
- A missing test around code a finding changes: fold it into that finding's acceptance criteria instead of filing it separately.
- Instructions that drifted from the code: `AGENTS.md` says one thing and the code does another (for example, a "light theme only" rule after dark mode shipped). That drift is a finding.

---

## Verification gates for filed work

For any finding that deletes or consolidates code, discover the repo's gate scripts (typecheck, test, lint, knip, i18n check) and cite them in the ticket's acceptance criteria, for example:

```bash
<pm> run typecheck && <pm> run knip && <pm> run test
```

Do not run fixers or make edits as part of the audit. The implementer runs these gates.
