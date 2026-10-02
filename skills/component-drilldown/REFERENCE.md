# Component drilldown: reference

The repo's own `AGENTS.md`, `CLAUDE.md`, and design docs outrank everything here. This file says what to look for, not what the answer is.

## Finding where a component is used

```bash
bash <skill-dir>/scripts/find-usages.sh src/components/ui/button.tsx           # import-resolved
bash <skill-dir>/scripts/find-usages.sh src/components/ui/button.tsx src app   # limit search paths
bash <skill-dir>/scripts/find-usages.sh Button                                 # symbol text search
```

The script is read-only. It uses ripgrep when installed, grep otherwise, and runs on bash 3.2.

- **File mode** finds every import, re-export, dynamic `import()`, `require`, and test `mock(...)` whose last path segment matches the file. It resolves relative specifiers against the importing file, and alias specifiers (`@/`, `~/`, `#`, `$lib/`) by suffix match against the file's path. An `index` file also matches imports of its directory. Each consumer shows how many JSX tags of the exported components it renders.
- **Unresolved same-name imports** are listed separately. They are either a different module with the same basename, or an alias the script cannot map (monorepo workspace packages, bundler aliases). Check `tsconfig.json` paths before deciding.
- **Manual equivalent**: grep `<src>` for `from '<alias>/<path-without-extension>'`, for relative imports ending in `/<basename>`, and for the exported symbol. Exclude the component's own file.

Zero non-test consumers marks a dead-code candidate. Before deleting, confirm with knip if the repo uses it, and rule out dynamic imports with computed paths, string-keyed registries, MDX, auto-imported components, and references from outside the code (CMS content, email templates rendered by name).

## Reading variants

- **Variant-table components** (`cva`, `tailwind-variants`): transcribe every `variants` group, all its options, `compoundVariants`, and `defaultVariants`. The variant keys are the public API.
- **Other components**: the variants are the discriminating props. Look for a union-typed `variant`, `size`, `status`, `tone`, `side`, or `mode`; booleans such as `compact` or `bare`; and **derived state**, where a card computes its icon, badge, and colour from a status value.
- **Create vs edit forms** usually derive the mode from whether a record or `id` prop is present, not from a `variant` prop.

## Conventions checklist

Apply the repo's rules first. Each item below applies only if the repo has that system; when the docs are silent, follow what the neighbouring components do.

- **Design tokens, not raw colours.** Use semantic classes (`bg-primary`, `text-foreground`, `border-border`, `bg-muted`, `text-destructive`). Avoid raw palette classes (`text-white`, `bg-gray-100`), inline `style={{ color }}`, and arbitrary values for foundational colours. The repo docs list any exceptions, such as brand or status colours.
- **Theme.** Find out whether dark mode is supported. If the app is light-only, do not add `dark:` variants. If dark mode is opt-in, every token you use must be defined for both themes.
- **Direction (RTL apps).** Use logical properties: `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`, `rounded-s`. Use `rtl:`/`ltr:` variants for icons that must mirror. Never hard-code `dir` inside a shared component; the document root sets it.
- **i18n (apps with a translation library).** Every user-facing string goes through the translation function, using the client or server variant the framework requires. Add the key to every locale's message file in the right namespace. Reuse the repo's established wording for recurring states (active and inactive, enabled and disabled) instead of inventing a synonym.
- **Types.** No `any`: use `unknown` and narrow. Take model types from the repo's generated or ORM types module instead of redeclaring them.
- **Imports.** Use the repo's path alias rather than deep relative paths (`../../../`), and follow the import order its linter enforces.
- **Naming.** Match the existing file-name style (kebab-case or PascalCase) and folder conventions.
- **Formatting.** Dates, times, numbers, and currency go through the shared formatter helpers. Find them with `rg -n 'export (function|const) format' <src>`. Never call `toLocaleDateString` inline.
- **Loading and empty states.** Use the repo's skeleton, loader, and empty-state primitives instead of a hand-rolled spinner or "no results" block.
- **Accessibility.** Icon-only buttons need an accessible label; decorative icons need `aria-hidden`.
- **Comments.** Follow the repo's comment policy. Some repos strip or forbid prose comments in CI.

## Rendering a component outside the app

To see a component in isolation, open a route in the running app that mounts it, or render it in a test. Either way, it needs the ambient stack the root layout provides, or it will not behave as it does in production. Read the root layout and the test setup files to see what each provides:

- `dir` and `lang` on `<html>`, and any theme or environment attribute the CSS keys off.
- The headless UI library's direction provider, if the app is RTL. CSS `dir` by itself gives logical properties, but not RTL alignment or arrow-key order inside floating primitives such as menus and popovers.
- The i18n provider, with real messages and the app's timezone.
- Animation feature loading (for example a `LazyMotion` ancestor when components use `m.*`).
- The toast container, for anything that fires a toast.
- Auth or session context, data-fetching providers, and sidebar or layout providers.

Test setup often mocks some of these globally, such as i18n or animation, and leaves others to wrap per render. Some components cannot render bare at all: ones that self-fetch through a server action or auth, or ones that need a parent provider.

## Consolidation playbook

1. **Identify** overlap: near-identical markup, duplicated variant tables, or parallel implementations of one idea (several status pills, several skeletons, a status card that is really an empty state).
2. **Choose the canonical** component: prefer one in the shared primitives directory, then the most used, then the most general.
3. **Design a superset API**: one variant table or one prop union that covers every state the duplicates expressed. Write it down before editing: old component + props → canonical + props.
4. **Migrate consumers** one duplicate at a time: `find-usages.sh <duplicate>`, update each import and its props, re-run the typecheck.
5. **Delete** the duplicate files, then confirm no orphans (`find-usages.sh` shows zero consumers; knip is clean).
6. **Verify**: typecheck → knip → tests → lint fix → format, using `<pm> run <script>`. Spot-check every migrated screen in the running app, including both themes and RTL if the app supports them.

Keep each change to one family of components.
