# design-variants

Builds a review board of 4-5 genuinely different designs for one page, section, component or flow, made from the product's real tokens, fonts, logo, copy, data and photos. The user picks one, and the skill builds the pick in the codebase and deletes what it replaces.

[skills.sh](https://skills.sh/alon710/configs/design-variants) · [SKILL.md](./SKILL.md)

## Install

```bash
npx skills add alon710/configs -s design-variants -g
```

## When to use it

- "Suggest a few alternatives for the contact section."
- "This pricing page looks generic and AI-made. Reimagine it."
- "Give me design directions for the onboarding flow."
- "All of these are bad. Show me new ones."

## What it does

1. Scopes the board to one thing, and notes where it renders and the job it must do.
2. Loads the design system from the repo: tokens, type, radii, shadows, button and card variants, logo and icons.
3. Collects real content: strings, data, names and photos from the product.
4. Chooses directions that differ in their idea (layout, entry point, interaction, density, tone), not just their styling.
5. Builds one self-contained HTML board, then renders it at desktop and mobile widths and fails on errors, placeholders, broken images or horizontal scroll.
6. Publishes the board and asks the user to pick one with a single question.
7. On "all bad", changes the axis, not the polish, for the next round.
8. Implements the pick with the repo's own components, deletes what it replaces, adds a test, runs the repo's checks, and records the decision.

## Works with

| Area | Detected and supported |
| --- | --- |
| Token sources | CSS variables, Tailwind v3 and v4, UnoCSS, Sass and Less variables, CSS-in-JS themes (MUI, Chakra, Mantine, styled-components, Emotion), Panda, Stitches, vanilla-extract, DTCG / Style Dictionary / Tokens Studio JSON, Vue and Svelte global styles |
| Fonts | `next/font`, `@fontsource` packages, `@font-face`, Google Fonts links. Self-hosted fonts that Google Fonts lacks are embedded or named as a fallback. |
| Publishing | An artifact host when the agent has one (Claude Code: the `Artifact` tool). Any other agent hands over the board's local `preview.html`, one self-contained file to open, send or host. |
| Asking | The agent's question tool, or a numbered list in plain text |

## Requirements

- Node with npm, and Python 3. `scripts/setup.sh` installs Playwright and Pillow once per machine into `~/.cache/design-variants-tools`, outside any repo.
- Google Chrome for rendering, or Playwright's bundled Chromium (`npx playwright install chromium` in the tools folder, then `export PW_CHANNEL=`).
- Internet access for Google Fonts on the board.

## Safety

- Nothing is sent from a board: forms call `preventDefault`, it never calls the product's API or writes data, and outbound links go only to the product's own channels.
- Real content only: no lorem ipsum, fake names, or invented claims or numbers.
- Boards live in the session's scratch directory, never a fixed `/tmp` path.
- When verifying the implementation, it serves a fresh build on a free port and never kills a server it didn't start.

## Files

| File | What it holds |
| --- | --- |
| `SKILL.md` | Quick start, the workflow, the non-negotiables |
| `REFERENCE.md` | Design-system extraction by stack, choosing directions, board anatomy, interactions, the pick question, iterating, implementing the pick, gotchas |
| `scripts/setup.sh` | One-time install of Playwright and a Pillow venv; prints `export` lines |
| `scripts/template.html` | The board skeleton: token block, intro, variant head and section frames |
| `scripts/assets.py` | Resizes and embeds images as data URIs, then inlines them into the board |
| `scripts/shoot.mjs` | Renders the board at 1280 and 390 px, saves per-variant PNGs and `preview.html`, and fails on problems |
