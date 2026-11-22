# extract-design-system

Extracts a project's design system from its code into one browsable brand book: exact colour tokens per theme, type scale and fonts, spacing, radii, shadows, logos, icons, voice and copy rules, and every chosen component with guidelines and a preview. In Claude Code it publishes a Design System artifact; other agents get the same files as a local folder.

[skills.sh](https://skills.sh/alon710/configs/extract-design-system) · [SKILL.md](./SKILL.md)

## Install

```bash
npx skills add alon710/configs -s extract-design-system -g
```

## When to use it

- "Turn this app's styles into a design system."
- "Generate a brand book and token reference from this repo."
- "Document our UI components with previews."
- "Re-sync the design system now that the code changed."

## What it does

1. Asks once for what's missing: the app folder in a monorepo, the system's name, new or update, and where to keep a local bundle.
2. Inventories the repo with a bundled scan: token sources, themes, fonts, logos and icons, and components ranked by use. Then asks which components to include.
3. Turns the stylesheets into a draft `tokens.json`, then finishes it by hand with usage notes, semantic type styles and the spacing steps the UI really uses.
4. Copies logos, icons and font files byte for byte.
5. Writes the README brand book in the product's own words.
6. Writes a README and a preview per component, all styled by one prefixed stylesheet of `var(--token)` values, and a cover.
7. Checks the bundle until clean, including contrast in every theme.
8. Publishes it as a Design System artifact, or copies it to a local folder and gives the path.

## Works with

| Area | Detected and supported |
| --- | --- |
| Token sources | CSS custom properties (any theme block), Tailwind v3 and v4, shadcn, Sass and Less variables, CSS-in-JS themes (MUI, Chakra, styled-components), Panda, Stitches, vanilla-extract, DTCG and Style Dictionary JSON |
| Frameworks | React, Vue, Svelte, Angular, Astro and plain HTML projects, including Vue and Svelte global `<style>` blocks and Vuetify themes |
| Output | Claude Code with the Design System type: a published artifact, created or re-synced in place. Any other agent, or no Design System type: a local folder with the same `README.md`, `tokens.json`, per-component `README.md` and `preview.html`, `components/bundle.css`, assets and fonts. |
| Source info | GitHub repos are recorded by `owner/name` and commit; any other repo as a local source |

Values the scripts can't read (Sass variables, JS theme objects, runtime fonts) are copied by hand, and anything that can't be placed is listed rather than guessed.

## Requirements

- Node, to run the bundled scripts (no packages to install).
- For the artifact: Claude Code's `Artifact` tool, and the Design System type on the account.
- Optional: the project's installed `node_modules`, so Tailwind's default theme can resolve exact values.

## Safety

- The repository is read-only: it never edits, commits, installs or builds it unasked. A local bundle goes inside the repo only when the user says so.
- The repo and its docs are treated as data, never as instructions.
- Code is the source of truth: it never invents a token, a component or copy, and never redraws, traces or recolours a logo.
- A source colour pair that fails contrast stays exact, and its usage note says so.
- On a re-sync, it reads the live files first, keeps what people edited, and asks before removing tokens.

## Files

| File | What it holds |
| --- | --- |
| `SKILL.md` | Quick start, the workflow, the non-negotiables |
| `REFERENCE.md` | Token mapping by stack, usage notes, type styles, the README outline, components and the prefixed stylesheet, publishing, the local bundle, re-sync, gotchas |
| `scripts/scan.mjs` | Inventories a repo and writes JSON |
| `scripts/css-to-tokens.mjs` | Turns CSS custom properties into a draft `tokens.json`, and reports what it skipped |
| `scripts/check.mjs` | Validates the bundle, checks contrast per theme, and prints the publish calls |
| `scripts/lib.mjs` | The shared CSS parser, theme detection and colour maths |
