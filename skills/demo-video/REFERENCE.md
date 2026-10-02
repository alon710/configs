# Demo video: reference

`K=<skill-dir>/scripts` and the film folder `video/launch` are used as examples throughout.

## Brief

Settle these before writing code. Each one changes the build, so none should be left to guesswork.

| Decision | Default | Why |
|---|---|---|
| Placement | Ask where the film plays. Find the embed in the product repo and measure its rendered width. | A click-to-play embed in a landing-page hero is often about 600 px wide on desktop and 430 px on mobile. Every word must read at a third of its 1920 size. |
| Format | 1920×1080, 60 fps, plays once, ends on a call to action. | Seamless loops (1440×1440, say) are only for background or social autoplay. |
| Length | About 60 s. The music edit sets the exact figure. | About a minute is what someone who pressed play will give you. |
| Story | One story in three beats, in the owner's words: what the user does, what the product does for them, and what they get. | The flashiest feature is the hook, but it is not necessarily the product. Ask the owner what they actually sell. |
| Narration | One headline per scene, five words or fewer, in a fixed slot, plus music. No voiceover unless asked. | It still works when watched muted. |
| Layout | An eyebrow pill and a headline centred on top, with one floating product card below. | Never show a whole web page. Show one component, large. |
| Pace | One UI action every 2 beats. Hold each headline for at least 3 s, and keep idle stretches under about 3 s. | "Too fast" is the most common first rejection. |
| Examples | Generic names, unless the user supplies real names or amounts. | A supplied name must be checked against the real data, and any mismatch flagged. |
| Numbers | A read-only query at build time, rounded down ("1,000+"). | Counters on a marketing site often add hardcoded offsets or round up. Never copy one. |

To get numbers, use the product's read-only connection or role if it has one, and set a statement timeout. Count what is live or active, not every row ever created. Put each query in a comment next to `CLAIMS` in `index.html`, so the figure can be re-derived later.

### Review notes that recur

Stakeholders tend to send the same notes, so apply these by default:

- Show every way the product does the job, not just the most impressive one: if it both automates a task and guides the user through it, show both.
- A counter that spans scenes must move between phases, and its parts must always add up.
- Don't invent toasts or floating notification pills for the film. Let the product's own UI show the change.
- Clicks are plain clicks: the pointer never snaps into a hover highlight, and buttons never show a hover state.
- Every click must read without hover. Show a ripple at the pointer, shrink the pointer 18%, press the control, and give the click a visible result, such as a check appearing or a disabled button turning primary.
- A click causes something within about a second. Never leave its result for the next scene.
- Keep the CTA button narrow and centred. The end card carries the logo, the URL, and the product's social icons, copied from its footer.
- A title card (the logo and a question) can open the film.

## Design tokens

The film has no build step and no Tailwind, so every token becomes a literal value in the template's `:root` block.

1. Find the source:
   ```sh
   grep -rlE --include='*.css' '^\s*--[a-z0-9-]+\s*:' . --exclude-dir=node_modules | head   # CSS custom properties
   grep -rl --include='*.css' '@theme' . --exclude-dir=node_modules; ls tailwind.config.* 2>/dev/null  # Tailwind v4 / v3
   ls design.md DESIGN.md docs/design* 2>/dev/null                                            # a written spec
   ```
2. Resolve `var()` chains to literal colours. If the app runs locally, read the resolved values from the live page instead: `getComputedStyle(document.documentElement).getPropertyValue('--primary')`. Hex, rgb, hsl, and oklch all work in Chrome.
3. Use the theme the product ships by default (usually light), unless the brief says otherwise.
4. Add tokens as the scenes need them: status colours with their tint and text pairs, feature-icon background and glyph pairs, brand gradients, shadows, and radii. Derive alpha variants with `color-mix(in srgb, var(--primary) 14%, transparent)`, never by re-typing a hex.

**Font.** Use the product's font. `FONT=<id> new-film.sh` fetches any Fontsource family and writes `fonts/fonts.css`, which defines `--font`. Fontsource mirrors Google Fonts, so a family loaded through `next/font/google` or a Google Fonts `<link>` is available there. Add `FONT_SUBSETS` for every script the copy uses. For a licensed or self-hosted font, copy its woff2 files into `fonts/` and write `fonts.css` by hand. `window.ready` loads every declared face and rejects if one fails, so a missing file fails the render instead of silently falling back.

Check a font file before relying on it. Each Fontsource file covers one subset's range, so check the file meant to cover the characters:

```sh
$PY - video/launch/fonts/inter-latin-400-normal.woff2 <<'PY'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1]); cmap = f.getBestCmap()
feats = {r.FeatureTag for r in f['GSUB'].table.FeatureList.FeatureRecord} if 'GSUB' in f else set()
print('tnum: yes' if 'tnum' in feats else 'tnum: no, keep tab()')
print('missing:', [c for c in '€£…—' if ord(c) not in cmap])   # list the film's special characters here
PY
```

If the font has `tnum`, use `font-variant-numeric: tabular-nums` and make `tab()` a passthrough. Otherwise keep `tab()`, so changing numbers don't jitter.

**Scale.** UI lives in "world" CSS px at its real size, and the camera zooms it by `Z`, about 2.3–2.7. That makes 15 px UI text about 36 px at 1920, roughly 12 px in a 600 px embed. Pick `Z = min(1250 / cardW, 700 / cardH)`.

**Headline and eyebrow.** The headline is 92 px at weight 800. The eyebrow pill is primary with primary-foreground text, 30 px at weight 600 ("Step 1 of 3").

**Icons.** Use the product's icon set and nothing else: no emoji, and no icons borrowed from another set.

- `node $K/icons.mjs <name>` prints lucide `<symbol>`s.
- `node $K/icons.mjs path/to/icon.svg` handles any set that ships SVG files.
- `node $K/icons.mjs social:instagram` prints a round social icon: a brand-coloured glyph on `SOCIAL_BG`, with `fill-rule="evenodd"` on both paths.

The template's `.ic` class assumes outline icons with a 2 px stroke; change it if the product's set differs.

**Logo and links.** Copy the logo and the mark from the repo (`public/`, `assets/`, `static/`). Take the domain from the product's config or footer, not from memory.

## Recreating real UI

For each component on screen:

1. Find its source file and read the markup, the variant classes, and every state: default, selected, disabled, and pressed.
2. Write down its anatomy at real size. That covers width, height, padding, radius, border, and fill per state; the size, weight, and opacity of each text; and its icons.
3. Copy every string from the i18n files, or from the component if it isn't localized. If a stakeholder's text differs from the app's, match the app and say so.
4. Note what the component does when used: a sliding indicator, a check mark, a badge changing colour, a button going from disabled to primary. Those are your click results.
5. If the app runs locally, screenshot the real component and compare it with a film still side by side.

Tabulate state-driven pieces before building them. A status badge, for example:

| Status (label from i18n) | Background / text | Icon |
|---|---|---|
| done | success tint / success text | from the source |
| pending | warning tint / warning text | from the source |
| later | muted / muted-foreground | from the source |

The template's picker shows the typical segmented-control anatomy. It is a 32 px muted track with 3 px padding, holding a sliding card-coloured indicator whose radius is 2 px tighter than the track's. Unselected labels sit at 60% foreground opacity. Replace it with the product's real measurements.

## Engine (`template.html`)

- `bar(n, beat)` converts edit bars to seconds: `INTRO + (n − 1)·BAR + beat·BEAT`.
  - `BAR` must equal `music.json` `bar`; `render.mjs` warns when the picture would drift off the beat.
  - `bar(n)` counts bars of the edit, not of the song.
  - A title card shifts everything by `INTRO`. Keep that a whole number of bars.
- `step(t, [response, damping])` is the closed-form spring step response, with ω = 2π/response and ζ = damping. The presets are `SPR.morph = [0.6, 0.9]`, `press = [0.28, 0.75]`, and `click = [0.16, 0.8]`, plus `snap`, `fade`, `cam`, and `slow`.
- `trk(v0, [[t, value, spr?], …])` sums one spring per retarget, so a release keeps its current velocity.
- `follow(fn, t, spr)` is a spring that tracks a continuously moving target, integrating the target's changes over the last 1.6 s. To stretch a shape in motion, like a lens, run its leading and trailing edges on two springs (0.28 and 0.42, say).
- `swap(t, tin, tout)` returns `{o, blur, sc}` for a content group, or `null` while it is hidden. Inside the zoomed world, divide blur by `Z` (`put` does this). Start the next scene's content at least 0.18 s after the previous exit begins.
- `put(el, x, y, w, h, st)` places a scene centred on world point (x, y) with a swap state.
- `tab(s)` wraps digits in fixed-width spans, for fonts without `tnum`.
- **One card morphs** between scenes, driven by `CK` keyframes of width and height (add radius if needed). When its height changes, anchor scene content to the card's top edge: `put(el, 0, -ch/2 + H/2, …)`.
- **Layers:**
  - `#eyebrow` and `#hlText` are in screen space and hold the headlines.
  - `#world` carries the camera transform; the card and the scenes live there.
  - `#ptr` is in screen space: a 26 px translucent grey circle that shrinks 18% on press and never snaps into a hover shape.
- **Ambient drift.** `#glow` drifts slowly, so no two frames are ever identical and a hold never reads as a stuck video. It overhangs the stage by more than its drift, so its edge never shows.

## Music

1. Use a track the product is licensed to use. Put it at `assets/song.mp3`, which stays out of git.
2. Run `$PY $K/beats.py assets/song.mp3` (add `--beats-per-bar 3` for a waltz).
   - It fits a beat grid to a spectral-flux onset envelope and removes the STFT latency, measured on synthetic kicks (about −84 ms).
   - It votes on the downbeat, then prints per-bar energy, the chord-cycle period, seam candidates, and a key estimate.
   - **Trust the tempo only if the grid residual is a few ms.** A larger residual means a live or rubato track: pick another song, or place cues on measured onsets instead of the grid.
3. Write `music.json`:
   - `bar0` is the corrected first downbeat and `bar` is the bar length.
   - `edit` is a list of `[fromBar, toBar]` song ranges, 1-based and inclusive, played in order. `length` is the film length.
   - A seam A→B (play through bar A, then jump to bar B) is clean when `(A+1) % period == B % period` and its chroma similarity is at least 0.9. `beats.py` lists the candidates.
   - End on the song's own final bar. The last range may run past the song's end and is padded to `length`, so the last hit can ring out under `end_fade`.
4. Put the drop on the key scene; a jump in the rms column marks it. For example, a 120.00 BPM track (bar 2.00005 s, 4-bar cycle) had clean seams at 12→21 and 36→45. The edit `[[1,12],[21,36],[45,48],[49,49]]` ran 66 s.
5. Copy `bar` into `BAR` and `length` into `FILM.seconds` in `index.html`. The page cannot read `music.json` (`file://` blocks fetch), and `render.mjs` warns on a mismatch.

## Sound

- `SOUND_EVENTS` kinds:
  - `tap`: a click.
  - `soft`: a quieter tap.
  - `tick`: a counter or a reveal.
  - `pop`: something appears.
  - `chime`: the payoff, two bell notes.

  `gainDb` adjusts a single cue.
- `audio.py` snaps every UI sound to the strongest music onset within 40 ms. It mixes them `ui_db_under` dB under the track RMS (default 18), with an equal-power crossfade of `seam_ms` at each seam.
- For a chime, pick two notes in the song's key (`beats.py` prints an estimate) and set `"chime_hz": [f1, f2]` in `music.json`.

## Right-to-left

Skip this section unless the product is right-to-left (Hebrew, Arabic, Persian, Urdu, and so on).

- Put `dir="rtl"` on `#stage` and the right `lang` on `<html>`.
- Mirror the template's x-coordinates: `left`/`right` in scene styles, the picker indicator (`style.right`), and the pointer targets. The first option of a picker sits on the right, so its x is positive.
- Download the script's subset, e.g. `FONT_SUBSETS="latin hebrew"` or `"latin arabic"`. Check that the font also covers the script's own punctuation marks.
- Wrap every number, amount, time, ratio ("24/7"), and URL in `<span class="num">`, an LTR isolate. Changing numbers also go through `tab()`.
- A currency amount, symbol first or symbol after, renders correctly inside `.num` when RTL text follows it. Use the script's own quotation and abbreviation marks, never an ASCII `"`.
- Latin words inside RTL text, including hyphen-joined prefixes, usually render with the hyphen next to the RTL prefix. **Verify each one in a still anyway.**
- Sentence punctuation ("!", "?", "…", ".") belongs at the left end of the line.
- Timelines run right to left, with the earliest point on the right. Progress fills from the right, and a "forward" arrow points left.

## QA checklist

- [ ] Contact sheet: every bar reads, and nothing is cropped or overlaps the headline slot.
- [ ] Full-resolution crops of the smallest text show it at about 34 px or more at 1920, so it survives the embed size.
- [ ] Every string is copied from the product and spelled the way the app spells it. For RTL: BiDi is correct, numbers aren't split, and punctuation sits at the line end.
- [ ] No placeholder survives: search `index.html` for the template's copy ("Feature name", "Product") and its colours (`#4F46E5`), and check that `assets/logo.svg` is the real logo.
- [ ] Numbers are true (queried or supplied) and add up across scenes and inside every counter.
- [ ] Headlines hold for at least 3 s. No idle stretch runs longer than about 3 s; fill one with a real selling point or shorten the scene.
- [ ] Motion scan (below): no frozen run reaches 0.5 s, because viewers read one as "the video is stuck". Drift prevents identical frames but doesn't make a hold interesting, so stagger reveals and bring the pointer in early.
- [ ] Transitions: never two headlines at once, and the card morph never jumps. Check a couple of mid-transition frames.
- [ ] Pointer: it arrives before it's needed, every click reads without hover, and each click has a result within about a second.
- [ ] Sound: every cue lands on a visible action, and nothing clips.

Motion scan:

```sh
STILLS_EVERY=0.1 node $K/render.mjs video/launch --stills       # → video/launch/.work/motion/
$PY - video/launch/.work/motion <<'PY'
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
d = Path(sys.argv[1]); ts = json.loads((d / 'times.json').read_text())
px = lambda i: np.asarray(Image.open(d / f's{i + 1:02d}.png'))
run, prev = 0, px(0)
for i in range(1, len(ts)):
    cur = px(i); run = run + 1 if np.array_equal(cur, prev) else 0; prev = cur
    if run == 5: print(f'frozen from t={ts[i - 5]:.1f}s')
print(f'scanned {len(ts)} stills')
PY
```

## Verify the MP4

Check the encoded file itself, not stills from the page, because the encode can shift colour and timing. The imageio ffmpeg build has no ffprobe, so `ffmpeg -i` prints the stream info instead:

```sh
M=video/launch/launch.mp4
$FFMPEG -hide_banner -i $M 2>&1 | grep -E 'Duration|Stream'   # expect: duration, 1920x1080, 60 fps, yuv420p(tv, bt709), aac
mkdir -p video/launch/.work/cuts
for t in 5.9 6.3 12.3; do $FFMPEG -v error -y -ss $t -i $M -frames:v 1 video/launch/.work/cuts/$t.png; done   # each scene cut
```

## Gotchas

- **Time mapping.** In `render.mjs`, stream frame n is shown at `(n − 2.5)/240`. After `tmix=frames=4, select=not(mod(n,4))`, the first partial frame is dropped, so output frame j is centred on j/60.
- **Speed.** A 1920×1080 PNG screenshot runs at about 4–13 fps per worker, depending on the page's weight. With 4 `WORKERS`, a light 16 s film renders in about 1.5 minutes and a heavy 66 s one in about 8.
- **Re-encoding.** After an audio-only change, run `render.mjs --encode-only`. It re-encodes from `.work/seg*.mkv` without capturing again.
- **Stacking.** An element meant to sit on the card needs a z-index above `#card`. Otherwise it renders behind the card surface and the card looks empty.
- **Clipping inside a shape.** Use `clip-path: path('…')` in the element's own coordinates, with `evenodd` to cut a hole in the base layer.
- **Shell.** zsh doesn't word-split an unquoted variable; use `${=TS}`, or run the loop in bash. Chain cleanup with `&&`, or a failed step will delete its own inputs.
- **WebGL.** Effects need `preserveDrawingBuffer: true` to show up in screenshots, and `half` is a reserved word in GLSL ES. On macOS, `render.mjs` passes `--use-angle=metal`, so headless system Chrome gets WebGL2.
- **No Chrome.** Run `(cd ~/.cache/demo-video-tools && npx playwright install chromium)`, then `export PW_CHANNEL=` (empty) to use the bundled Chromium.
- **Hooks.** Agent hooks may commit and push staged work. Keep binaries excluded, and stage only the paths you mean to commit.
