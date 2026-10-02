#!/usr/bin/env bash
# Scaffolds a film folder: index.html from this skill's template, the product's font from Fontsource
# (fonts/fonts.css), assets copied in, a music.json stub, and .git/info/exclude entries so renders,
# audio, stills, and songs never get committed.
#
# Usage: [FONT=<fontsource-id>] [FONT_WEIGHTS="400 500 600 700 800"] [FONT_SUBSETS="latin latin-ext"] \
#          bash new-film.sh <film-dir> [asset-file ...]
#   FONT          Fontsource id of the product's font: inter, open-sans, ibm-plex-sans, ... (fontsource.org
#                 mirrors Google Fonts). For a licensed or self-hosted font, omit it, copy the woff2 files
#                 into fonts/, and write fonts/fonts.css by hand (@font-face rules plus :root{--font:...}).
#   FONT_SUBSETS  add the product's scripts, e.g. "latin hebrew", "latin arabic", "latin cyrillic".
#   asset-file    copied into <film-dir>/assets/: the logo, the logo mark, product images. The template's
#                 end card shows assets/logo.svg; a labelled placeholder is written if none is given.
set -euo pipefail
DIR=${1:?usage: new-film.sh <film-dir> [asset-file ...]}
shift
SK=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CDN=https://cdn.jsdelivr.net/npm/@fontsource
mkdir -p "$DIR/fonts" "$DIR/assets"
if [ -f "$DIR/index.html" ]; then
  echo "$DIR/index.html exists; not overwriting" >&2
else
  cp "$SK/template.html" "$DIR/index.html"
fi

if [ ! -s "$DIR/fonts/fonts.css" ]; then
  if [ -n "${FONT:-}" ]; then
    family="" faces=""
    for w in ${FONT_WEIGHTS:-400 500 600 700 800}; do
      all=$(curl -sf "$CDN/$FONT/$w.css") || { echo "warning: $FONT has no weight $w" >&2; continue; }
      for s in ${FONT_SUBSETS:-latin latin-ext}; do
        block=$(printf '%s\n' "$all" | awk -v id="/* $FONT-$s-$w-normal */" 'BEGIN{RS=""} index($0, id) == 1')
        [ -n "$block" ] || { echo "warning: $FONT has no $s subset at weight $w" >&2; continue; }
        file="$FONT-$s-$w-normal.woff2"
        [ -s "$DIR/fonts/$file" ] || curl -sfo "$DIR/fonts/$file" "$CDN/$FONT/files/$file"
        [ -n "$family" ] || family=$(printf '%s\n' "$block" | sed -n "s/.*font-family: *\(['\"][^'\"]*['\"]\).*/\1/p" | head -1)
        faces+=$(printf '%s\n' "$block" | sed -E "s#src: url\(\./files/([^)]*\.woff2)\) format\('woff2'\).*#src: url(\1) format('woff2');#")
        faces+=$'\n\n'
      done
    done
    [ -n "$faces" ] || { echo "error: no font files for FONT=$FONT; check the id at fontsource.org" >&2; exit 1; }
    { printf ':root{--font:%s,system-ui,sans-serif}\n\n' "$family"; printf '%s' "$faces"; } > "$DIR/fonts/fonts.css"
    echo "font: $family (${FONT_WEIGHTS:-400 500 600 700 800}; ${FONT_SUBSETS:-latin latin-ext})" >&2
  else
    printf '%s\n' '/* No FONT given: add @font-face rules for the product font here, then set --font. */' \
      ':root{--font:system-ui,sans-serif}' > "$DIR/fonts/fonts.css"
    echo "note: no FONT given; the film uses system-ui until fonts/fonts.css defines the product font" >&2
  fi
fi

for f in "$@"; do cp "$f" "$DIR/assets/"; done
if [ ! -f "$DIR/assets/logo.svg" ]; then
  cat > "$DIR/assets/logo.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="56" viewBox="0 0 240 56"><rect x="1" y="1" width="238" height="54" rx="12" fill="none" stroke="#A1A1AA" stroke-width="2" stroke-dasharray="6 6"/><text x="120" y="34" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" fill="#71717A">replace assets/logo.svg</text></svg>
SVG
  echo "note: assets/logo.svg is a placeholder; copy the product's logo over it" >&2
fi

if [ ! -f "$DIR/music.json" ]; then
  cat > "$DIR/music.json" <<'JSON'
{
  "song": "assets/song.mp3",
  "bar0": 0.0,
  "bar": 2.0,
  "edit": [[1, 8]],
  "length": 16.0,
  "seam_ms": 30,
  "ui_db_under": 18,
  "end_fade": 1.2
}
JSON
fi

# Keep binaries out of git: agent hooks and `git add -A` commit whatever is untracked. info/exclude lives in
# the common git dir, so it covers every worktree and never shows up in a diff.
if ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null); then
  ROOT=$(cd "$ROOT" && pwd -P)
  ABS=$(cd "$DIR" && pwd -P)
  REL=${ABS#"$ROOT"}; REL=${REL#/}; P=${REL:+$REL/}
  GC=$(cd "$DIR" && cd "$(git rev-parse --git-common-dir)" && pwd -P)
  mkdir -p "$GC/info"
  EX="$GC/info/exclude"
  for pat in "*.mp4" "*.wav" "*.png" "*.mp3" "*.m4a" "assets/*.mp3" "assets/*.wav" "assets/*.m4a" \
    "stills/" ".work/" "events.json"; do
    grep -qxF "$P$pat" "$EX" 2>/dev/null || echo "$P$pat" >> "$EX"
  done
else
  echo "note: $DIR is not inside a git repo; skipped .git/info/exclude" >&2
fi
echo "scaffolded $DIR: put the song at $DIR/assets/song.mp3, run beats.py on it, then fill music.json"
