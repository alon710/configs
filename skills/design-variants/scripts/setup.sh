#!/usr/bin/env bash
# One-time tool setup for design-variant boards, shared by every repo on this machine (nothing lands in a repo).
# Installs into $DV_TOOLS (default ~/.cache/design-variants-tools): a Python venv with Pillow, and Playwright.
# Rendering uses the system Google Chrome (channel "chrome"), so no browser download is needed.
# Without Chrome: (cd "$DV_TOOLS" && npx playwright install chromium) and export PW_CHANNEL=
#
# Usage: eval "$(bash setup.sh)"   # prints only export lines for PY and PW_MODULE on stdout
set -euo pipefail
T=${DV_TOOLS:-${XDG_CACHE_HOME:-$HOME/.cache}/design-variants-tools}
mkdir -p "$T"
[ -x "$T/.venv/bin/python" ] || python3 -m venv "$T/.venv" >&2
"$T/.venv/bin/pip" install -q --disable-pip-version-check pillow >&2
if [ ! -d "$T/node_modules/playwright" ]; then
  (cd "$T" && npm init -y >/dev/null && npm i -s playwright) >&2
fi
if [ ! -d "/Applications/Google Chrome.app" ] && ! command -v google-chrome >/dev/null 2>&1 \
  && ! command -v google-chrome-stable >/dev/null 2>&1; then
  echo "warning: Google Chrome not found. Install it, or run (cd \"$T\" && npx playwright install chromium) and export PW_CHANNEL=" >&2
fi
cat <<OUT
# design-variants tools (eval this, or paste it into your shell)
export PY="$T/.venv/bin/python"
export PW_MODULE="$T/node_modules/playwright/index.mjs"
OUT
