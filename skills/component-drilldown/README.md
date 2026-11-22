# component-drilldown

Explains, fixes, or consolidates UI components in a web app's codebase. You get a component's variants, props and every real consumer, a fix that follows the repo's own conventions, or duplicate components merged into one shared primitive with every caller migrated.

[skills.sh](https://skills.sh/alon710/configs/component-drilldown) · [SKILL.md](./SKILL.md)

## Install

```bash
npx skills add alon710/configs -s component-drilldown -g
```

## When to use it

- "What variants does the `Badge` component have, and where is it used?"
- "Fix `PricingCard` so it follows our design tokens and RTL rules."
- "We have three empty-state components. Merge them into one."
- "Is `LegacyTable` still used anywhere?"

## What it does

1. Learns the repo's component system once: the instructions file and design docs, the framework, where components live, the variant system, the import alias and the package manager.
2. Reads the component and transcribes every variant and key prop.
3. Finds consumers with a bundled script that resolves relative, alias and index imports, template tags and stylesheet imports, and lists tests and stories separately.
4. To fix: applies the repo's conventions (tokens, theme, RTL, i18n, types, imports, formatting, accessibility) and updates every consumer the change touches.
5. To consolidate: confirms real duplication, picks the canonical component, designs a superset variant API, migrates consumers one duplicate at a time and deletes the rest.
6. Verifies with the repo's own typecheck, tests, lint and format, then checks a route that renders the component.

## Works with

| Area | Detected and supported |
| --- | --- |
| Frameworks | React, Preact, Solid, Vue and Nuxt, Svelte and SvelteKit, Angular, Astro, web components (Lit, Stencil, vanilla) |
| Variant systems | `cva`, `tailwind-variants`, Panda, Stitches, vanilla-extract recipes, styled-components and Emotion props, CSS modules, BEM classes in plain CSS or Sass |
| Component libraries | shadcn/ui, shadcn-vue and shadcn-svelte (`components.json`), and wrappers around MUI, Chakra, Mantine, Ant Design, Vuetify, PrimeVue, Angular Material or an internal package |
| Import aliases | `tsconfig`/`jsconfig` `paths`, Vite and webpack aliases, SvelteKit `kit.alias`, Nuxt `alias`, `package.json` `imports` |
| Package managers | bun, pnpm, yarn, npm, read from the lockfile |

The repo's own `AGENTS.md`, `CLAUDE.md` or design docs always outrank the skill's defaults. When the docs are silent, it follows what the neighbouring components do.

## Requirements

- `bash` (3.2 or newer) and `grep` for `scripts/find-usages.sh`. `rg` (ripgrep) is optional and used when installed.
- The repo's own toolchain to verify changes (its typecheck, test, lint and format scripts).
- Optional: `knip`, if the repo uses it, to confirm dead code after a consolidation.

## Safety

- `find-usages.sh` is read-only.
- Reads every consumer before changing a prop or variant, and updates all of them in the same change.
- Before calling a component dead, rules out dynamic imports, string-keyed registries, auto-imported components and references from outside the code.
- Keeps each consolidation to one family of components, so it stays reviewable and revertable.

## Files

| File | What it holds |
| --- | --- |
| `SKILL.md` | Learning the component system, and the explain, fix and consolidate workflows |
| `REFERENCE.md` | Using the usage finder, a per-framework table, reading variants, the conventions checklist, rendering a component in isolation, and the consolidation playbook |
| `scripts/find-usages.sh` | Lists the import-resolved consumers of a file (or text matches for a symbol), split into source, templates, and tests or stories |
