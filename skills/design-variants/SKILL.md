---
name: design-variants
description: Builds a review board of 4-5 genuinely different UI/UX variants for one page, section, component or flow, rendered in the project's own design system (its tokens, fonts, logo, components, real copy, real data and real photos). Publishes the board as a shareable artifact or a local HTML preview, asks the user to pick one, then implements the pick in the codebase and deletes what it replaces. Use when the user asks for design alternatives, options, variants, directions or mockups, says "suggest alternatives" or "reimagine this section", says a screen looks bad, generic, immature or AI-made, or rejects a previous set of options ("all are bad, new ones").
---

# Design variants

A board is one HTML page in the scratch directory. It shows 4-5 numbered variants of one thing, each built from the product's real design system and content, so the user chooses between real candidates and not between sketches. The pick is then built in the codebase, and the board is thrown away.

`<skill-dir>` is the directory holding this file. `<scratch>` is the session scratch directory, or `mktemp -d`. Never use a fixed `/tmp` path, because parallel sessions collide there.

## Quick start

```sh
K=<skill-dir>/scripts
eval "$(bash $K/setup.sh)"                                    # once per machine: Playwright + Pillow, prints PW_MODULE and PY
cp $K/template.html <scratch>/board/contact.src.html          # write the variants into it
$PY $K/assets.py embed <scratch>/board/assets.json hero=public/photos/hero.jpg:1400x700 team=public/team/a.jpg:160x160
$PY $K/assets.py inline <scratch>/board/contact.src.html <scratch>/board/assets.json > <scratch>/board/contact.html
node $K/shoot.mjs <scratch>/board/contact.html                # per-variant desktop + mobile PNGs, errors, overflow
```

Look at every PNG, fix what you see, then publish `contact.html` (Claude Code: the `Artifact` tool, with a generic icon). Without an artifact host, hand over the `preview.html` that `shoot.mjs` writes next to the board.

## Workflow

- [ ] **Scope one thing.** One section, page, component or flow per board. Note where it renders, who uses it, and the job it must do (for example, "turn a visitor into a WhatsApp message").
- [ ] **Load the design system from the repo.** Read `AGENTS.md` / `CLAUDE.md` and any design doc first. Then read the token source (`globals.css` `@theme` / `:root`, the Tailwind config, `tokens.json`), the font setup, the radius and shadow scale, button and card variants, the logo files and the icon set. Copy exact values into the board's `:root`. Never invent a colour, and never keep a placeholder. See [REFERENCE.md → Design system](REFERENCE.md#design-system).
- [ ] **Collect real content.** Take strings from the i18n files or the source, data from seeds, fixtures or a read-only query, and photos from `public/` or the CMS. Use the real phone numbers, names and times. Lorem ipsum and stock filler are what make a board look AI-made.
- [ ] **Choose directions that differ in their idea, not their styling.** Each variant changes at least two axes: layout model, entry point, interaction, density and tone. Write each one's one-line reason before drawing it. If two lines read alike, replace one. See [REFERENCE.md → Choosing directions](REFERENCE.md#choosing-directions).
- [ ] **Build the board** from `template.html`. Each variant gets a number, a short name and a one-line "why", and sits in `<section data-variant="n">`. Wire the interaction where the interaction is the idea (a picker, a filter, a finder). Keep it demo-safe: forms call `preventDefault`, and outbound links go only to the product's own channels.
- [ ] **Check it with the script, then look.** `shoot.mjs` fails on page errors, failed requests, leftover placeholders, broken images and horizontal scroll at 390 px. Then read every `v<n>-desktop.png` and `v<n>-mobile.png` yourself.
- [ ] **Publish and ask.** Give the board link and ask with one single-select question. Each option repeats the variant's name and its reason. With 5 variants, list 1-4 and say "or type 5". Ask what fails when the user wants something none of the options give.
- [ ] **On "all bad", change the axis, not the polish.** The next round must not reuse any rejected layout model. Say in one line what this round tries differently. See [REFERENCE.md → Iterating](REFERENCE.md#iterating).
- [ ] **Implement the pick** with the repo's own primitives. Reuse its components, update every caller, delete the components and messages the pick replaces, add a test (with axe where the repo uses jest-axe), run the repo's checks, then screenshot the real route at desktop and mobile widths. See [REFERENCE.md → Implementing the pick](REFERENCE.md#implementing-the-pick).
- [ ] **Record the decision** in the repo's design notes (for example, the design section of `AGENTS.md`): which variant won, and why, in one line.

## Non-negotiables

1. **The product is the source of truth** for tokens, type, logo, copy and data. A board that uses its own palette or font previews nothing.
2. **Variants are different ideas.** Four colour or spacing tweaks of one layout count as one variant.
3. **Real content only.** Placeholders, fake names, and invented claims or numbers do not ship on a board.
4. **The board is self-contained.** Images are embedded as data URIs by `assets.py`, fonts come from Google Fonts, and there is no local `file://` or `localhost` URL. Aim for under 2 MB.
5. **Accessible by default.** Text contrast meets AA on the product's tokens, layouts are RTL when the product is, and every layout works at 390 px with no horizontal scroll.
6. **Nothing is sent from a board.** It never posts a form, calls the product's API or writes data.

## Files

- [REFERENCE.md](REFERENCE.md): design-system extraction, the axes for choosing directions, board anatomy, interaction rules, the pick question, iterating after a rejection, implementing the pick, and gotchas (BiDi, artifact limits, fonts, image weight).
- `scripts/setup.sh`: one-time install of Playwright (system Chrome by default) and a Pillow venv in `~/.cache/design-variants-tools`. Prints `export` lines.
- `scripts/template.html`: the board skeleton: token block, intro, a variant head pattern and section frames.
- `scripts/assets.py`: `embed` resizes and centre-crops images to data URIs in a JSON map, and `inline` replaces `{{asset:name}}` in a board with them.
- `scripts/shoot.mjs`: renders the board at 1280 and 390 px. It saves one PNG per variant per width, writes `preview.html`, and exits non-zero on errors, placeholders, broken images or overflow.
