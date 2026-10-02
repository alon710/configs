---
name: design-system-migration
description: Migrates pages or components off a legacy hand-rolled UI pattern (a copy-pasted hero, section wrapper, card, table, or modal) onto the repo's shared design-system primitives, one call site at a time. Finds legacy call sites by grep, learns the target shape from already-migrated reference pages, applies a before/after transformation with explicit delete and keep rules, verifies with lint, typecheck, and a grep proving the legacy code is gone, and keeps a running ledger of migrated and remaining targets. Use when asked to "redesign", "apply the design system to", or "move X onto the shared component" for a page, to replace an old pattern across pages, or when a file still imports a legacy component the design system has replaced.
---

# Design-system migration

Moves call sites off a legacy pattern onto shared primitives. **Only the chrome changes.** Behaviour, data, and copy stay exactly as they were. One page or component per change, tracked in a ledger until nothing remains.

## 1. Define the migration

Do this once per legacy pattern, and record it in the ledger (step 4).

- **Legacy signature.** The import of the legacy component, plus the distinctive markup of copies that import nothing: a class combination (`min-h-[40vh]` + `rounded-b-[2rem]`), an inline `<svg><pattern>`, blurred decorative blobs (`blur-3xl`), an entrance-animation wrapper. Copy-pasted variants are the ones an import grep misses.
- **Target primitives.** Read their source. List the props and slots (title, subtitle, actions, image) and everything they render themselves, because whatever they draw is what you delete from the call site.
- **Surrounding conventions.** Section backgrounds, vertical spacing, container width, and heading levels, from the repo's design doc (`design.md`, `AGENTS.md`) and the reference pages.

## 2. Find legacy call sites

```bash
rg -l "from ['\"][^'\"]*/<legacy-module>['\"]" <src>            # importers
rg -l '<distinctive-class>|<pattern id=' <src> -g '*.{tsx,jsx,vue,svelte}'   # copy-pasted variants
rg -n '[a-z]-[a-z0-9-]+/[0-9]+/[0-9]+' <src>                    # malformed classes from earlier find/replace
```

Without ripgrep: `grep -rlE --include='*.tsx' --exclude-dir=node_modules '<pattern>' <src>`.

## 3. Pick reference pages

Already-migrated pages define the target shape better than any doc.

```bash
rg -l '<TargetPrimitive>' <src>                          # pages already on the target
git log -S '<TargetPrimitive>' --oneline -- <src>        # the commits that migrated them
```

Read the first migration commits' diffs: they show the real transformation, including what was deleted. Pick one to three references closest in shape to your page (same route group, similar sections).

## 4. Open the ledger

Keep the running list in `.context/design-system-migration/<migration-slug>.md`. First confirm it is git-ignored:

```bash
git check-ignore -q .context/design-system-migration/x.md && echo ignored || echo NOT-ignored
```

If it is not ignored, ask the user whether to ignore `.context/` (in `.gitignore` or `.git/info/exclude`) or to track the ledger in a shared doc instead. If the team keeps a project-local copy of this skill, the ledger can be a `## Status` section in that copy. When `.claude/` is git-ignored, that copy needs `git add -f`, and only when the user asks to commit.

```markdown
# Migration: <legacy> → <target>

Legacy signature: import `<alias>/<legacy-module>`; markup `<distinctive classes>`, inline SVG pattern, blur blobs, entrance animation
Target: `<PageHero title subtitle actions? imageUrl?>` + `<SectionHeader>`; sections alternate `<tint token>` / `<card token>`, `<spacing>`, `<container>`
References: `<path/to/reference-1>`, `<path/to/reference-2>`
Find remaining: rg -l '<legacy-module>|<distinctive-class>' <src>

## Migrated
- [x] <path> (<date>, <PR>)

## Remaining
- [ ] <path>

## Special cases
- <call site>: needed <feature>; handled by <new optional prop>
```

Re-run the "find remaining" command at the start of every session. The list drifts as other branches merge.

## 5. Apply the transformation

Write the before/after once in the ledger, then apply it to each file. Example for a hero; the primitive names are placeholders for the repo's own:

```tsx
// Before
import { m } from 'motion/react';

<div className="bg-white">
  <section className="relative min-h-[40vh] overflow-hidden rounded-b-[2rem] bg-gradient-to-b from-blue-50 to-white">
    <div className="absolute -top-20 -left-20 size-72 rounded-full bg-blue-100/30 blur-3xl" />
    <svg className="absolute inset-0 opacity-10"><pattern id="dots">{/* ... */}</pattern></svg>
    <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <h1 className="text-4xl font-bold text-gray-900">{t('faq.title')}</h1>
      <p style={{ color: '#6b7280' }}>{t('faq.subtitle')}</p>
    </m.div>
  </section>
  <section id="questions" className="scroll-mt-20 bg-muted/50/50 py-12">
    <FaqList items={items} />
  </section>
</div>

// After
import { PageHero } from '<alias>/components/ui/page-hero';

<div className="bg-card">
  <PageHero title={t('faq.title')} subtitle={t('faq.subtitle')} />
  <section id="questions" className="scroll-mt-20 bg-muted py-14 md:py-20">
    <div className="container mx-auto px-4">
      <FaqList items={items} />
    </div>
  </section>
</div>
```

### Keep

- **Client logic**: state, effects, handlers, search and filtering, form logic.
- **Data**: fetching, `Suspense` boundaries, loading and error states.
- **i18n**: the same translation calls and keys, now passed as the primitive's props. Do not rename keys or inline literals.
- **Anchors**: `id` and `scroll-margin` classes that links and navigation point at.
- **Page contracts**: metadata and SEO exports, structured data, analytics attributes, `data-testid`, accessibility attributes.
- **Heading order**: one `h1` per page. If the primitive renders it, remove the old one.
- **Content components that render their own header**: keep passing them `title` and `subtitle` instead of adding a section header above them, so nothing renders twice.

### Delete

- **The whole legacy block**, not just its import: every decorative layer the primitive draws itself (gradients, blur blobs, inline SVG patterns, overlay scrims).
- **Entrance animations the design system does not use**, plus the animation import once nothing in the file uses it. Keep motion that carries meaning, such as an expanding accordion, if the reference pages keep it.
- **Raw palette colours**: swap them for semantic tokens (`bg-white` → the card or background token, `text-gray-600` → the muted-foreground token).
- **Inline `style`** for colour or spacing.
- **Wrapper hacks** the primitive makes unnecessary: negative-margin full-bleed wrappers, extra `relative overflow-hidden` shells, hand-rolled max-width containers.
- **Malformed class names** left by an earlier find-and-replace, such as a doubled opacity suffix (`bg-muted/50/50`) or repeated tokens. They are not real classes; Tailwind drops them silently.

Copy the reference pages' section and container markup exactly, including any direction or theme attributes they set. Do not improvise new spacing or backgrounds.

## 6. Call sites the target cannot express

When a legacy call site has something the primitive lacks, such as a CTA button, a cover image, or a full-bleed photo variant, **extend the primitive with an optional prop** (an `actions` slot, an `imageUrl` with a scrim that keeps the title readable). Do not keep a fork or add a second variant component: one component replaces every legacy variant. Leaving the prop out must give the default look. Pass values in already-normalized form (image URLs through the repo's URL helper, for example). Changing a shared primitive is its own step: read every existing consumer first, and record the new prop under the ledger's special cases.

## 7. Verify each file

1. **Baseline first.** Before editing, run lint and typecheck once on the untouched tree and save the output (`.context/` or `mktemp`). Then you can tell your errors from pre-existing ones, such as a known warning elsewhere or baseline errors in test files.
2. **Gates**: `<pm> run lint` and `<pm> run typecheck`, using the repo's real script names (the lockfile tells you `<pm>`). Filter typecheck output to the files you touched.
3. **Grep proof**: this should print nothing for the migrated file:
   ```bash
   grep -nE "<legacy-module>|<distinctive-class>|[a-z]-[a-z0-9-]+/[0-9]+/[0-9]+" <file>
   ```
   Add the animation import to the pattern if you removed every use of it.
4. **Look at it** next to a reference page, at desktop and mobile widths, in both themes if the app has them, and in RTL if the app supports it. Check that anchors still scroll into place.

## 8. Update the ledger and finish

- Move the file from Remaining to Migrated, with the date and PR.
- When Remaining is empty and the find command prints nothing, the legacy component should have zero importers. Delete it in a final change, after confirming with a usage search and knip if the repo uses it.
- Suggest guarding against regressions, for example a `no-restricted-imports` lint rule for the legacy module. That is a suggestion for the user, not an edit to make unasked.
