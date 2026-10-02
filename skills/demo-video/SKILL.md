---
name: demo-video
description: Builds product demo and explainer videos as code. One HTML page recreates the product's real UI from its own design system and is animated by a pure seek(t) on a measured music beat grid. Playwright renders it frame-accurately to an H.264 MP4 with a music edit and synthesized UI sounds. Use when asked to make, redo, extend, or re-time a product demo, explainer, promo, launch, or homepage hero video or UI animation, a social clip or seamless loop, to cut a film to a song, or when a stakeholder sends review notes on one of these films.
---

# Demo video

A film is one folder in the product repo (default `video/<name>/`). `index.html` is the film, `music.json` is the music edit, and everything rendered stays out of git. Every frame is `seek(t)`, a pure function of time with no CSS transitions, timers, or state carried between frames. That means any frame can be re-rendered on its own, and a 240 fps capture blends into clean 60 fps motion blur.

`<skill-dir>` is the directory holding this file. Run every command from the product repo root.

## Quick start

```sh
K=<skill-dir>/scripts
eval "$(bash $K/setup.sh)"      # once per machine (~/.cache/demo-video-tools); sets PY, PW_MODULE, FFMPEG
FONT=inter bash $K/new-film.sh video/launch public/logo.svg   # template, product font, logo, music.json, git excludes
$PY $K/beats.py video/launch/assets/song.mp3                  # tempo, downbeat, seams, key → fill music.json
```

To preview any moment, load `file://<abs-path>/video/launch/index.html?t=3` in Chrome. The render loop:

```sh
node $K/render.mjs video/launch --stills && $PY $K/contact.py video/launch  # contact sheet, one still per bar
node $K/render.mjs video/launch --events && $PY $K/audio.py video/launch    # sound cues → audio.wav
node $K/render.mjs video/launch                                             # full render → video/launch/launch.mp4
```

## Workflow

- [ ] **Settle the brief before writing code.** Offer `/grill-me` if the user wants to be interviewed. Settle placement (it sets the aspect ratio and minimum text size), length, one story, headlines or voiceover, layout, and which numbers and named examples may appear. Defaults and reasons: [REFERENCE.md → Brief](REFERENCE.md#brief).
- [ ] **Load the design system from the product repo:** colour tokens, radii, shadows, font, logo, and icon set. Fill the template's token block from them. Never invent a value, and never ship the placeholders. See [Design tokens](REFERENCE.md#design-tokens).
- [ ] **Verify every claim.** Each number on screen comes from a read-only query against real data at build time, rounded down. Never take one from marketing copy, which often carries hardcoded offsets. Named examples (accounts, items, prices) stay generic unless the user supplies real ones. Check supplied ones against the data, and flag mismatches instead of silently fixing them.
- [ ] **Measure the music** with `beats.py`. Treat the tempo as exact only when the grid residual is a few ms. Cut only on seams that keep the bar's position in the chord cycle (usually 4 bars), and end on the song's own ending. See [Music](REFERENCE.md#music).
- [ ] **Show the beat map** (bar, time, scene, action, sound) and wait for an OK when the user wants to review first.
- [ ] **Build from the real product.** Copy every string from the product's i18n files or source, spelled exactly as the app spells it. Recreate each component from its source: sizes, radii, states, and colours. Show one component, large, never a whole page. See [Recreating real UI](REFERENCE.md#recreating-real-ui).
- [ ] **Iterate on stills, not renders:** use `?t=` in a browser, or `render.mjs --stills`. Crop the smallest text at full resolution.
- [ ] **QA before the full render** with the [QA checklist](REFERENCE.md#qa-checklist): text readable at the embed size, numbers that add up, no dead time, and continuity across cuts.
- [ ] **Render, then verify the MP4 itself:** duration, 60 fps, bt709 tags, an audio stream, and frames pulled from the encoded file at every scene cut. See [Verify the MP4](REFERENCE.md#verify-the-mp4).
- [ ] **Report** the path, the specs, and every place you departed from the brief or the notes, with the reason.

## Non-negotiables

1. **`seek(t)` is pure.** No CSS transitions or animations, no `setTimeout` or `requestAnimationFrame`, and no state that survives between calls.
   - Springs are closed-form step responses, summed once per retarget (`trk`).
   - A target that moves continuously uses `follow`.
   - Content swaps use `swap`: the exit is a 120 ms blur, the entry rides its own spring, and the two never overlap.
2. **The product is the source of truth** for tokens, font, strings, icons, and component anatomy. The template's placeholders mark what to replace, not what to keep.
3. **Numbers are real, and film work is read-only.** It never writes to the product's database, runs its migrations, or starts its CI.
4. **Binaries stay out of git.** `new-film.sh` adds renders, audio, stills, and songs to `.git/info/exclude`, because agent hooks and a stray `git add -A` commit whatever is untracked. Commit film sources only when asked, and stage them by path.
5. **Scratch work goes in the film's `.work/`**, never a fixed `/tmp` path, because parallel worktrees and sessions collide there.
6. **If the product is right-to-left, BiDi blocks the render.** Check every string in a still. See [Right-to-left](REFERENCE.md#right-to-left).

## The page contract

`render.mjs` needs only these from `index.html`. Everything else in the template is yours to replace.

| Export | Used for |
|---|---|
| `window.FILM = {width, height, fps, seconds, bar}` | Viewport and frame count. `seconds` and `bar` are checked against `music.json`. |
| `window.seek(t)` | Sets every element for time `t`, in seconds. |
| `window.ready` | A promise that resolves once fonts and images load, and rejects if a font fails. |
| `window.SOUND_EVENTS = [{t, kind, gainDb?}]` | `--events` → `events.json` → `audio.py`. Kinds: `tap`, `soft`, `tick`, `pop`, `chime`. |
| `window.STILL_TIMES = [t, …]` | `--stills` → `stills/sNN.png` → the contact sheet. |

## Files

- [REFERENCE.md](REFERENCE.md): brief defaults, recurring review notes, design tokens at film scale, recreating real UI, the engine API, music and sound, right-to-left rules, the QA checklist, MP4 verification, and gotchas.
- `scripts/setup.sh`: one-time install of a Python venv (numpy, imageio-ffmpeg, pillow, fonttools) and Playwright into `$VIDEO_TOOLS`, default `~/.cache/demo-video-tools`.
- `scripts/new-film.sh`: scaffolds a film. Takes `FONT=<fontsource-id>`, `FONT_WEIGHTS`, and `FONT_SUBSETS`, plus asset files to copy.
- `scripts/template.html`: the starter film, with the engine, a token block, and three placeholder scenes.
- `scripts/beats.py` measures the song. `scripts/audio.py` builds `audio.wav` from the edit plus UI sounds.
- `scripts/render.mjs` writes stills, events, and the full render. `scripts/contact.py` builds the contact sheet.
- `scripts/icons.mjs`: icon `<symbol>`s from lucide, any SVG file, or react-social-icons.
