---
name: component-drilldown
description: Explains, fixes, or consolidates UI components in a web app's codebase. Covers what a component is, its variants and props, and every place it is used (resolving relative, alias, and index imports), bringing a component in line with the repo's own conventions, and merging duplicate or overlapping components into one shared primitive with a superset variant API. Use when the user asks what a component does, what variants or props it has, or where it is used; asks to fix a component to follow repo conventions (design tokens, RTL, i18n, typing, imports); or asks to find and merge duplicate components.
---

# Component drilldown

The source file and its consumers are the ground truth. Docs, inventories, and component workbenches (Storybook and similar) are indexes: use them to find things fast, then confirm against source.

## Step 0: learn the component system

Do this once per repo, before any workflow below.

1. Read `AGENTS.md`, `CLAUDE.md`, and any design doc they link (design tokens, type scale, component rules). The conventions you enforce come from there first.
2. Find where components live. Check `components.json` (shadcn's `aliases.ui`) first, then look for the usual directories:
   ```bash
   find . \( -name node_modules -o -name .git \) -prune -o -type d \( -name ui -o -name components -o -name primitives -o -name design-system \) -print | head -20
   ```
   Typical split: shared primitives (`components/ui/`), shared composite trees (`components/<area>/`), and domain components (`features/<domain>/components/`). In a monorepo, also check `packages/ui`.
3. Note the variant system (`cva`, `tailwind-variants`, CSS modules, styled variants), the import alias (`compilerOptions.paths` in `tsconfig.json` or `jsconfig.json`), and the package manager from the lockfile.
4. If the repo keeps a component inventory (often under `.context/` or `docs/`), use it as an index. It is a snapshot and can be stale.

## Workflow: explain a component

1. Locate the file by name across the component directories.
2. Read it. List the exported components, their purpose, and every variant: transcribe each `cva` variant group plus `defaultVariants`, or the union-typed, boolean, and derived-state props (see [REFERENCE.md](REFERENCE.md#reading-variants)).
3. Find usages:
   ```bash
   bash <skill-dir>/scripts/find-usages.sh <path/to/component.tsx>   # import-resolved consumers
   bash <skill-dir>/scripts/find-usages.sh <ComponentName>           # text search for a symbol
   ```
   It resolves relative, alias, ESM `.js`-suffixed, and index-directory imports. It lists tests, stories, and mocks separately, and lists same-named modules that resolve elsewhere so you do not count them.
4. Report: name · path · variants table · key props · consumer files (flag zero consumers) · the routes those consumers render under.

## Workflow: fix a component

1. **Read the component and all its usages first.** A prop or variant change breaks callers, and tests that render or mock it break too.
2. Apply the repo's conventions. The [checklist](REFERENCE.md#conventions-checklist) names what to look for; each item applies only if the repo has that system.
3. If the variant or prop API changed, **update every consumer** in the same change. Without a workbench, only the typechecker catches a stale variant name, and only when variants are typed.
4. Verify in this order: typecheck → tests → lint (fix mode) → format. Use the repo's scripts as `<pm> run <script>`. Then view a route that mounts the component in the running app.

## Workflow: consolidate components

1. **Find overlap**: similar names (`*-badge`, `*-empty-state`, `*-skeleton`, `*-card`), near-identical markup, duplicated variant tables, parallel implementations of one idea.
2. **Confirm it is real duplication.** Diff the implementations. Same-shaped markup with different semantics (a status pill and a plan-tier pill) can be deliberately separate.
3. **Pick the canonical** component: prefer the one in the shared primitives directory, then the most used, then the most general.
4. **Design a superset variant API**: one variant table (or one prop union) that covers every state the duplicates expressed. Do not lose a state.
5. **Migrate every consumer**, one duplicate at a time: run `find-usages.sh` on the duplicate, move each import and its props to the canonical, then re-run the typecheck.
6. **Delete the duplicates** in the same change. Confirm nothing imports them (`find-usages.sh` shows zero consumers; knip is clean if the repo uses it).
7. **Verify**: typecheck → knip (no dead exports) → tests → lint fix → format, then spot-check the migrated screens. Full playbook: [REFERENCE.md](REFERENCE.md#consolidation-playbook).

Keep each consolidation to one family of components per change, so it stays reviewable and revertable.
