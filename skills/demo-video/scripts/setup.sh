#!/usr/bin/env bash
# One-time tool setup for demo films, shared by every repo on this machine (nothing lands in a repo).
# Installs into $VIDEO_TOOLS (default ~/.cache/demo-video-tools): a Python venv (numpy, imageio-ffmpeg
# with a static ffmpeg, pillow, fonttools + brotli for inspecting woff2 fonts) and Playwright.
# Rendering uses the system Google Chrome (channel "chrome"), so no browser download is needed.
# Without Chrome: (cd "$VIDEO_TOOLS" && npx playwright install chromium) and export PW_CHANNEL=
#
# Usage: eval "$(bash setup.sh)"   # prints only export lines for PY, PW_MODULE, FFMPEG on stdout
set -euo pipefail
T=${VIDEO_TOOLS:-${XDG_CACHE_HOME:-$HOME/.cache}/demo-video-tools}
mkdir -p "$T"
[ -x "$T/.venv/bin/python" ] || python3 -m venv "$T/.venv" >&2
"$T/.venv/bin/pip" install -q --disable-pip-version-check numpy imageio-ffmpeg pillow fonttools brotli >&2
if [ ! -d "$T/node_modules/playwright" ]; then
  (cd "$T" && npm init -y >/dev/null && npm i -s playwright) >&2
fi
FF=$("$T/.venv/bin/python" -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
if [ ! -d "/Applications/Google Chrome.app" ] && ! command -v google-chrome >/dev/null 2>&1 \
  && ! command -v google-chrome-stable >/dev/null 2>&1; then
  echo "warning: Google Chrome not found. Install it, or run (cd \"$T\" && npx playwright install chromium) and export PW_CHANNEL=" >&2
fi
cat <<OUT
# demo-video tools (eval this, or paste it into your shell)
export PY="$T/.venv/bin/python"
export PW_MODULE="$T/node_modules/playwright/index.mjs"
export FFMPEG="$FF"
OUT
