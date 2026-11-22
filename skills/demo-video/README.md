# demo-video

Builds product demo and explainer videos as code. One HTML page recreates the product's real UI from its own design system, animates it on the music's beat grid, and renders to an H.264 MP4 with a music edit and synthesized UI sounds.

[skills.sh](https://skills.sh/alon710/configs/demo-video) · [SKILL.md](./SKILL.md)

## Install

```bash
npx skills add alon710/configs -s demo-video -g
```

## When to use it

- "Make a 60-second demo video for the homepage hero."
- "Cut a launch film for the new feature to this song."
- "Make a seamless loop of the dashboard for social."
- "Here are the review notes on the demo film. Apply them."

## What it does

1. Settles the brief first: placement and embed size, length, one story, headlines, layout, and which numbers and names may appear.
2. Loads the design system from the product repo (tokens, font, logo, icons) into the film's token block.
3. Takes every number from a read-only query against real data, and copies every string from the product.
4. Measures the song (tempo, downbeat, clean seams, key) and writes the music edit.
5. Builds each scene from the real component's source, animated by a pure `seek(t)` with closed-form springs.
6. Iterates on stills and a contact sheet, then runs a QA checklist: readable text at embed size, numbers that add up, no dead time, continuity across cuts.
7. Renders frame-accurately at 240 fps into 60 fps motion blur, mixes UI sounds onto the music, and verifies the encoded MP4.

## Works with

| Area | Detected and supported |
| --- | --- |
| Token sources | CSS variables, Tailwind v3 and v4, Sass and Less variables, CSS-in-JS themes, Panda, Stitches, vanilla-extract, design-token JSON, a written design spec, or the running app's computed styles |
| Fonts | Any Fontsource (Google Fonts) family, fetched by id; licensed or self-hosted woff2 files copied in by hand |
| Icons | lucide (`lucide-react` or `lucide-static`), any icon set that ships SVG files, and round social icons from `react-social-icons`. Other lucide packages work by installing `lucide-static` into the tools folder. |
| Direction | Left-to-right and right-to-left products (Hebrew, Arabic and others), with BiDi rules |
| Data | Whatever database the product uses, through its read-only connection or role |

## Requirements

- Node with npm, Python 3 and `curl`. `scripts/setup.sh` installs Playwright, numpy, Pillow, fontTools and a static ffmpeg once per machine into `~/.cache/demo-video-tools`, outside any repo.
- Google Chrome for rendering, or Playwright's bundled Chromium (`npx playwright install chromium` in the tools folder, then `export PW_CHANNEL=`).
- A song the product is licensed to use.
- `git` (optional), so `new-film.sh` can keep renders and audio out of commits.

## Safety

- Film work is read-only for the product: it never writes to the product's database, runs its migrations, or starts its CI.
- Renders, audio, stills and songs go into `.git/info/exclude`. Film sources are committed only when asked, and staged by path.
- Scratch work stays in the film's own `.work/` folder, never a fixed `/tmp` path.
- Numbers on screen come from real data, rounded down, never from marketing copy. Mismatches in supplied examples are flagged, not silently fixed.

## Files

| File | What it holds |
| --- | --- |
| `SKILL.md` | Quick start, the workflow, the non-negotiables, the page contract |
| `REFERENCE.md` | Brief defaults, recurring review notes, design tokens at film scale, recreating real UI, the engine API, music and sound, right-to-left rules, QA, MP4 checks, gotchas |
| `scripts/setup.sh` | One-time install of the Python venv and Playwright; prints `export` lines |
| `scripts/new-film.sh` | Scaffolds a film: template, product font, assets, `music.json`, git excludes |
| `scripts/template.html` | The starter film: the engine, a token block, three placeholder scenes |
| `scripts/beats.py` | Measures a song: tempo, downbeat, seams, key |
| `scripts/audio.py` | Builds `audio.wav` from the music edit plus UI sounds |
| `scripts/render.mjs` | Writes stills, sound events and the full MP4 render |
| `scripts/contact.py` | Builds a contact sheet from the stills |
| `scripts/icons.mjs` | Prints icon `<symbol>`s from lucide, SVG files or social icons |
