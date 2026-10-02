#!/usr/bin/env bash
# First-pass audit scan. Prints LEADS, not findings: confirm every line by reading
# the source before you report it.
#
# Usage (run from the repo root):
#   bash <skill-dir>/scripts/audit-scan.sh                          # auto-detected source roots
#   bash <skill-dir>/scripts/audit-scan.sh src/features/billing     # one or more scope paths
#   SKIP_KNIP=1 bash <skill-dir>/scripts/audit-scan.sh              # skip the slow knip step
#
# Uses ripgrep when it is installed and falls back to grep/find otherwise.
# Never runs a fixer, never installs or downloads anything, never writes to the repo.
# Portable to bash 3.2 (the macOS default): no associative arrays, no mapfile.
set -o pipefail

have() { command -v "$1" >/dev/null 2>&1; }
HAVE_RG=0
have rg && HAVE_RG=1

EXCLUDE_DIRS=(node_modules .git dist build out .next .nuxt .svelte-kit .turbo .vercel .output .cache coverage vendor storybook-static .context)
EXCLUDE_FILES=('*.test.*' '*.spec.*' '*.stories.*' '*.d.ts' '*.min.js' '*.map')
SRC_EXT="ts,tsx,js,jsx,mjs,cjs,vue,svelte,astro"
UI_EXT="tsx,jsx,vue,svelte,astro"
TS_EXT="ts,tsx"
Q="['\"]"
NQ="[^'\"]"

# File-system routes, app roots, and framework entrypoints have no importer by design.
ENTRY_RE='(^|/)(page|layout|route|loading|error|global-error|not-found|forbidden|unauthorized|template|default|head|middleware|proxy|instrumentation|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[a-z]+$|(^|/)\+[^/]*$|(^|/)(pages|routes)/|(^|/)(_app|_document|_error)\.[a-z]+$|^(src/)?(main|index|App|app|root|entry[^/]*)\.[a-z]+$'

WORK=$(mktemp -d 2>/dev/null || mktemp -d -t audit-scan)
trap 'rm -rf "$WORK"' EXIT

# search MODE EXTS PATTERN PATH...
#   MODE: n = file:line:text, l = matching file names, o = matched text only
#   EXTS: comma-separated extensions. PATTERN: an extended regex both engines accept.
search() {
  local mode="$1" exts="$2" pat="$3" e d f
  shift 3
  [ $# -gt 0 ] || return 0
  local args=()
  if [ "$HAVE_RG" = 1 ]; then
    case "$mode" in n) args=(-n -H --no-heading) ;; l) args=(-l) ;; o) args=(-o -N --no-filename) ;; esac
    # Include globs first: in ripgrep the LAST matching glob wins, so an include placed
    # after the exclusions would re-admit *.test.* and *.stories.* files.
    for e in $(echo "$exts" | tr ',' ' '); do args+=(-g "*.$e"); done
    for d in "${EXCLUDE_DIRS[@]}"; do args+=(-g "!**/$d/**"); done
    for f in "${EXCLUDE_FILES[@]}"; do args+=(-g "!$f"); done
    rg --color never "${args[@]}" -e "$pat" -- "$@" 2>/dev/null
  else
    case "$mode" in n) args=(-rnHE) ;; l) args=(-rlE) ;; o) args=(-rhoE) ;; esac
    for e in $(echo "$exts" | tr ',' ' '); do args+=(--include="*.$e"); done
    for d in "${EXCLUDE_DIRS[@]}"; do args+=(--exclude-dir="$d"); done
    for f in "${EXCLUDE_FILES[@]}"; do args+=(--exclude="$f"); done
    grep "${args[@]}" -e "$pat" -- "$@" 2>/dev/null
  fi | sed 's#^\./##'
}

# list_files EXTS PATH...
list_files() {
  local exts="$1" e d f
  shift
  [ $# -gt 0 ] || return 0
  if [ "$HAVE_RG" = 1 ]; then
    local args=()
    for e in $(echo "$exts" | tr ',' ' '); do args+=(-g "*.$e"); done
    for d in "${EXCLUDE_DIRS[@]}"; do args+=(-g "!**/$d/**"); done
    for f in "${EXCLUDE_FILES[@]}"; do args+=(-g "!$f"); done
    rg --files "${args[@]}" -- "$@" 2>/dev/null
  else
    local prune=(-name "${EXCLUDE_DIRS[0]}") names=() skip=()
    for d in "${EXCLUDE_DIRS[@]:1}"; do prune+=(-o -name "$d"); done
    for e in $(echo "$exts" | tr ',' ' '); do
      [ ${#names[@]} -gt 0 ] && names+=(-o)
      names+=(-name "*.$e")
    done
    for f in "${EXCLUDE_FILES[@]}"; do skip+=(! -name "$f"); done
    find "$@" \( "${prune[@]}" \) -prune -o -type f \( "${names[@]}" \) "${skip[@]}" -print 2>/dev/null
  fi | sed 's#^\./##' | sort
}

h() { printf '\n\n== %s ==\n' "$1"; }
note() { printf '   (%s)\n' "$1"; }

# hits EXTS PATTERN: per-file hit counts over the scope (so one noisy file cannot swallow
# the list), then a few raw examples.
hits() {
  local out nfiles nlines
  out=$(search n "$1" "$2" "${TARGET[@]}")
  if [ -z "$out" ]; then
    echo "   (none)"
    return
  fi
  printf '%s\n' "$out" | awk -F: '{c[$1]++} END {for (f in c) printf "  %4d  %s\n", c[f], f}' | sort -rn | head -20
  nlines=$(printf '%s\n' "$out" | wc -l | tr -d ' ')
  nfiles=$(printf '%s\n' "$out" | cut -d: -f1 | sort -u | wc -l | tr -d ' ')
  printf '   lines: %s, files: %s. examples:\n' "$nlines" "$nfiles"
  printf '%s\n' "$out" | head -5 | cut -c1-200 | sed 's/^/     /'
}

# --- package.json helpers (node when available, text fallback otherwise) ---
detect_pm() {
  if [ -f bun.lock ] || [ -f bun.lockb ]; then echo bun
  elif [ -f pnpm-lock.yaml ]; then echo pnpm
  elif [ -f yarn.lock ]; then echo yarn
  elif [ -f package.json ]; then echo npm
  fi
}
script_names() {
  [ -f package.json ] || return 0
  if have node; then
    node -e 'try{const s=require(process.cwd()+"/package.json").scripts||{};console.log(Object.keys(s).join(" "))}catch(e){}' 2>/dev/null
  else
    awk '/"scripts"[[:space:]]*:/ {f=1; next} f && /^[[:space:]]*}/ {exit}
         f && match($0, /"[^"]+"[[:space:]]*:/) {s=substr($0, RSTART+1, RLENGTH-1); sub(/"[[:space:]]*:$/, "", s); printf "%s ", s}' package.json
  fi
}
script_body() {
  [ -f package.json ] || return 0
  if have node; then
    node -e 'try{const s=require(process.cwd()+"/package.json").scripts||{};console.log(s[process.argv[1]]||"")}catch(e){}' "$1" 2>/dev/null
  else
    sed -nE "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"(.*)\",?[[:space:]]*\$/\1/p" package.json | head -1
  fi
}
has_script() { case " $SCRIPTS " in *" $1 "*) return 0 ;; esac; return 1; }
has_dep() { [ -f package.json ] && grep -Eq "\"$1\"[[:space:]]*:" package.json; }

# --- scope ---
ROOTS=()
for d in src app components features lib hooks utils pages server modules packages apps; do
  [ -d "$d" ] && ROOTS+=("$d")
done
[ ${#ROOTS[@]} -eq 0 ] && ROOTS=(.)

TARGET=()
if [ $# -gt 0 ]; then
  for p in "$@"; do
    if [ -e "$p" ]; then TARGET+=("${p%/}"); else echo "warning: scope path not found, skipped: $p" >&2; fi
  done
  [ ${#TARGET[@]} -gt 0 ] || { echo "no scope path exists; nothing to scan." >&2; exit 1; }
  SCOPED=1
else
  TARGET=("${ROOTS[@]}")
  SCOPED=0
fi

PM=$(detect_pm)
SCRIPTS=$(script_names)

echo "# audit scan: scope ${TARGET[*]} @ $(git rev-parse --short HEAD 2>/dev/null || echo 'no-git')"

TOP=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$TOP" ] && [ "$(cd "$TOP" && pwd -P)" != "$(pwd -P)" ]; then
  note "not at the repo root ($TOP): knip and package detection read the current directory"
fi

h "0. CONTEXT"
printf '   search engine: %s\n' "$([ "$HAVE_RG" = 1 ] && echo ripgrep || echo 'grep/find (ripgrep not installed)')"
if [ -n "$PM" ]; then
  printf '   package manager: %s (run scripts as "%s run <script>"; bare built-ins like "bun test" may not be the script)\n' "$PM" "$PM"
  gates=""
  for s in $SCRIPTS; do
    case "$s" in *type*|*tsc*|*lint*|*test*|*knip*|*format*|*i18n*|*check*|ci|*:ci|build) gates="$gates $s" ;; esac
  done
  printf '   gate-like scripts:%s\n' "${gates:- (none)}"
else
  note "no package.json: JS-specific sections will be mostly empty"
fi
docs=""
for f in AGENTS.md CLAUDE.md CONTRIBUTING.md .cursorrules design.md DESIGN.md docs/architecture.md; do
  [ -f "$f" ] && docs="$docs $f"
done
printf '   instruction docs:%s\n' "${docs:- (none found; ask the user where conventions live)}"
if [ -d .context/audits ]; then
  printf '   prior audits in .context/audits: %s file(s)\n' "$(find .context/audits -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
else
  printf '   prior audits: none (.context/audits does not exist)\n'
fi

h "1. DEAD WEIGHT - knip (unused files, exports, deps)"
if [ "${SKIP_KNIP:-0}" = "1" ]; then
  note "skipped via SKIP_KNIP=1"
elif [ ! -f package.json ]; then
  note "no package.json: skipped"
else
  KNIP=()
  if has_script knip; then
    if script_body knip | grep -Eq -- '--fix|--allow-remove-files'; then
      note "the package.json knip script applies fixes; not running it, because an audit never edits code"
    else
      KNIP=("$PM" run knip)
    fi
  fi
  [ ${#KNIP[@]} -eq 0 ] && [ -x node_modules/.bin/knip ] && KNIP=(node_modules/.bin/knip)
  if [ ${#KNIP[@]} -eq 0 ]; then
    note "no runnable knip (no safe script, no node_modules/.bin/knip); not downloading it. Section 2 is the fallback."
  else
    for c in knip.json knip.jsonc .knip.json .knip.jsonc knip.ts knip.config.ts knip.config.js; do
      [ -f "$c" ] && note "config $c: read its ignore/entry lists before trusting 'unused'"
    done
    note "running: ${KNIP[*]}"
    "${KNIP[@]}" 2>&1 | head -80
  fi
fi

# A scoped run is narrow enough for "1 importer" (an inline-it candidate) to be worth reading;
# repo-wide it is mostly noise, so only zero-importer files are listed.
MAXC=0
[ "$SCOPED" = 1 ] && MAXC=1
h "2. DEAD WEIGHT - UI component files with <= $MAXC importer(s)"
if has_dep nuxt || has_dep unplugin-vue-components || has_dep '@nuxt/[a-z-]+'; then
  note "components are auto-imported here (Nuxt/unplugin): import counts are meaningless, skipped"
else
  # Basename of every import / re-export / dynamic import / require specifier in the repo.
  {
    printf '__sentinel__\t0\n'
    search o "$SRC_EXT,mdx" "(from|import|require)[[:space:]]*\(?[[:space:]]*${Q}${NQ}+${Q}" . \
      | sed -E "s/^.*${Q}(${NQ}+)${Q}\$/\1/" \
      | sed -E 's/\?.*$//; s/\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte|astro)$//; s#/index$##' \
      | awk -F/ '{print $NF}' | sort | uniq -c | awk '{print $2 "\t" $1}'
  } >"$WORK/imported"
  {
    printf '__sentinel__\t-\n'
    list_files "$UI_EXT" "${TARGET[@]}" | grep -Ev "$ENTRY_RE" | awk '{
      n = $0; sub(/.*\//, "", n); sub(/\.[^.]+$/, "", n)
      if (n == "index") { d = $0; sub(/\/[^\/]*$/, "", d); sub(/.*\//, "", d); n = d }
      print n "\t" $0 }'
  } >"$WORK/components"
  awk -F'\t' -v max="$MAXC" '
    FNR == 1 { fi++; next }
    fi == 1 { c[$1] = $2; next }
    fi == 2 { k[$1]++; next }
    { n = c[$1] + 0; if (n <= max) {
        s = (k[$1] > 1) ? sprintf("   [name shared by %d files: count is per name]", k[$1]) : ""
        printf "  %d  %s%s\n", n, $2, s } }' \
    "$WORK/imported" "$WORK/components" "$WORK/components" | sort -n >"$WORK/dead"
  if [ -s "$WORK/dead" ]; then
    head -40 "$WORK/dead"
    total=$(wc -l <"$WORK/dead" | tr -d ' ')
    [ "$total" -gt 40 ] && note "$((total - 40)) more not shown; narrow the scope"
  else
    echo "   (none)"
  fi
  note "counts match import specifiers by basename, so a same-named file elsewhere hides a dead one."
  note "0 = delete candidate, 1 = inline candidate. Rule out dynamic/lazy imports, MDX, and string registries first."
fi

h "3. DUPLICATION - component files clustered by trailing name token (repo-wide)"
list_files "$UI_EXT" "${ROOTS[@]}" | grep -Ev "$ENTRY_RE" | awk '{
  p = $0; n = p; sub(/.*\//, "", n); sub(/\.[^.]+$/, "", n)
  if (n == "index") { d = p; sub(/\/[^\/]*$/, "", d); n = d; sub(/.*\//, "", n) }
  t = ""
  if (n ~ /[-_.]/) { k = split(n, a, /[-_.]/); if (k > 1 && a[k] != "") t = a[k] }
  else { for (i = length(n); i > 1; i--) if (substr(n, i, 1) ~ /[A-Z]/) { t = substr(n, i); break } }
  if (t != "") print tolower(t) "\t" p }' >"$WORK/tokens"
cut -f1 "$WORK/tokens" | sort | uniq -c | sort -rn | awk '$1 > 2' | head -10 >"$WORK/clusters"
if [ -s "$WORK/clusters" ]; then
  while read -r cnt tok; do
    printf '  %3d x *%s\n' "$cnt" "$tok"
    awk -F'\t' -v t="$tok" '$1 == t {print "        " $2}' "$WORK/tokens" | head -6
  done <"$WORK/clusters"
  note "same suffix is a lead only: diff the members before calling them duplicates"
else
  echo "   (no clusters of 3+)"
fi

h "4. DUPLICATION - files defining a variant table (cva / tailwind-variants)"
out=$(search l "$SRC_EXT" "(^|[^A-Za-z0-9_])(cva|tv)\(" "${TARGET[@]}" | head -30)
printf '%s\n' "${out:-   (none)}"
note "overlapping variant tables are the strongest consolidation signal"

h "5. CONSISTENCY - hand-rolled loaders"
hits "$UI_EXT" "animate-spin|Loader2|<Spinner|<CircularProgress"
note "compare against the loader/skeleton primitive the repo docs sanction"

h "6. CONSISTENCY - raw palette / inline colour (design-token bypass)"
has_dep tailwindcss || has_dep '@tailwindcss/[a-z-]+' || note "Tailwind not detected in package.json: palette matches may not apply"
COLORS='slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
hits "$UI_EXT" "(text|bg|border|ring|fill|stroke|from|via|to|outline|divide|decoration|accent|caret|placeholder)-(${COLORS})-[0-9]{2,3}|(text|bg|border)-(white|black)([^A-Za-z0-9-]|\$)|(text|bg|border|from|to|via)-\[#|style=\{\{[^}]*(colou?r|background)"
note "false positives: email templates, OG-image renderers, canvas/chart configs that need literal colours"

h "7. CONSISTENCY - malformed utility classes (botched find/replace)"
hits "$UI_EXT" "(bg|text|border|ring|from|via|to|fill|stroke|shadow)-[a-z0-9-]+/[0-9]+/[0-9]+"
note "a doubled opacity suffix such as bg-muted/50/50 is not a class; Tailwind drops it silently"

h "8. CONSISTENCY - date/number formatting outside shared helpers"
hits "$SRC_EXT" "toLocaleDateString|toLocaleTimeString|toLocaleString\(|Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat)"
note "the top file is often the shared helper itself; the others bypass it"

h "9. CONSISTENCY - hard-coded UI strings (i18n bypass)"
I18N=0
for dep in next-intl react-intl i18next react-i18next next-i18next vue-i18n svelte-i18n '@lingui/[a-z-]+' '@formatjs/[a-z-]+' '@inlang/paraglide-js' typesafe-i18n; do
  has_dep "$dep" && I18N=1
done
for d in messages locales i18n lang; do [ -d "$d" ] && I18N=1; done
if [ "$I18N" = 1 ]; then
  if [ "$HAVE_RG" = 1 ]; then L='\p{L}'; else L='[[:alpha:]]'; fi
  hits "$UI_EXT" ">[^<>{}]*${L}{3,}[^<>{}]*<|(placeholder|title|alt|aria-label|label)=\"[^\"{]*${L}{3,}"
  note "noise: generics/comparisons, brand names, dev-only pages, templates rendered without the i18n runtime"
else
  note "no i18n library or messages/locales dir detected: skipped"
fi

h "10. CONSISTENCY - physical left/right classes (RTL bypass)"
RTL=0
[ -n "$(search l "$SRC_EXT,css,html" "dir=[\"'{]*rtl|(^|[^A-Za-z])rtl:|DirectionProvider|direction:[[:space:]]*rtl" "${ROOTS[@]}" | head -1)" ] && RTL=1
for d in messages locales; do
  [ -d "$d" ] && ls "$d" 2>/dev/null | grep -Eq '^(he|ar|fa|ur|yi)([._-]|$)' && RTL=1
done
if [ "$RTL" = 1 ]; then
  SEP=$'[[:space:]"\'`:]'
  hits "$UI_EXT" "(^|${SEP})-?(ml|mr|pl|pr|left|right|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|border-l|border-r|scroll-ml|scroll-mr)-[0-9a-z\[]|(^|${SEP})(text-left|text-right|border-l|border-r)(${SEP}|\$)"
  note "logical equivalents: ms/me, ps/pe, start/end, text-start/text-end, rounded-s/e, border-s/e"
else
  note "no RTL support detected: skipped"
fi

h "11. SIMPLICITY - largest source files in scope"
list_files "$SRC_EXT" "${TARGET[@]}" >"$WORK/src"
if [ -s "$WORK/src" ]; then
  tr '\n' '\0' <"$WORK/src" | xargs -0 wc -l 2>/dev/null | grep -v ' total$' | sort -rn | head -15
else
  echo "   (no source files)"
fi

h "12. PERFORMANCE - client components (push interactivity to leaves)"
search l "$SRC_EXT" "^[[:space:]]*${Q}use client${Q}" "${TARGET[@]}" >"$WORK/client"
printf '   in scope: %s\n' "$(wc -l <"$WORK/client" | tr -d ' ')"
head -15 "$WORK/client" | sed 's/^/     /'
note "highest value: public/marketing routes and layouts marked client"

h "13. PERFORMANCE - fan-out, awaits in loops, fetch without a timeout"
sub() { [ -n "$2" ] && { echo "   $1:"; printf '%s\n' "$2" | sed 's/^/     /'; }; }
sub "fan-out" "$(search n "$SRC_EXT" "Promise\.(all|allSettled)\(" "${TARGET[@]}" | cut -c1-200 | head -15)"
sub "async callbacks / for-await (N+1 candidates)" "$(search n "$SRC_EXT" "\.(map|forEach|flatMap)\(async|for await[[:space:]]*\(" "${TARGET[@]}" | cut -c1-200 | head -10)"
sub "outbound fetch" "$(search n "$SRC_EXT" "await fetch\(" "${TARGET[@]}" | cut -c1-200 | head -10)"
note "check each array is bounded (chunk large fan-outs) and each outbound fetch has an abort signal/timeout"

h "14. BUNDLE - heavy dependencies imported from app code"
HEAVY='pdfjs-dist|react-pdf|@react-pdf/renderer|jspdf|html2canvas|@tiptap/[a-z-]+|quill|draft-js|lexical|monaco-editor|@monaco-editor/react|@codemirror/[a-z-]+|recharts|chart\.js|react-chartjs-2|echarts|d3|plotly\.js|three|@react-three/fiber|mapbox-gl|maplibre-gl|leaflet|@faker-js/faker|canvas-confetti|lottie-web|lottie-react|xlsx|exceljs|moment|lodash|highlight\.js|prismjs|shiki|firebase|@dnd-kit/[a-z-]+'
out=$(search n "$SRC_EXT" "from[[:space:]]*${Q}(${HEAVY})(/${NQ}*)?${Q}|import\([[:space:]]*${Q}(${HEAVY})" "${TARGET[@]}" | cut -c1-200 | head -20)
printf '%s\n' "${out:-   (none)}"
note "a hit matters if the file is client code and the import is not lazy-loaded"
echo "   two libraries doing one job (from package.json):"
dup_libs() {
  local label="$1" found="" d
  shift
  for d in "$@"; do has_dep "$d" && found="$found $d"; done
  [ "$(echo $found | wc -w | tr -d ' ')" -gt 1 ] && echo "     $label:$found"
}
{
  dup_libs icons lucide-react react-icons @heroicons/react @tabler/icons-react @phosphor-icons/react @radix-ui/react-icons @fortawesome/react-fontawesome
  dup_libs dates moment dayjs date-fns luxon
  dup_libs "class names" clsx classnames
  dup_libs animation framer-motion motion react-spring @react-spring/web gsap
  dup_libs http axios ky got node-fetch superagent
  dup_libs validation zod yup joi valibot superstruct
  dup_libs state redux @reduxjs/toolkit zustand jotai recoil mobx valtio
  dup_libs "data fetching" swr @tanstack/react-query
  dup_libs "css-in-js" styled-components @emotion/react @emotion/styled @stitches/react
  dup_libs charts recharts chart.js echarts @nivo/core victory
} >"$WORK/duplibs"
if [ -s "$WORK/duplibs" ]; then cat "$WORK/duplibs"; else echo "     (none)"; fi

h "15. COST - outbound paid-service calls and schedules"
out=$(search n "$SRC_EXT" "resend\.|\.emails\.send|sendEmail\(|sendMail\(|sgMail\.|postmark|generateText\(|generateObject\(|streamText\(|streamObject\(|embed(Many)?\(|chat\.completions|messages\.create\(|responses\.create\(|PutObjectCommand|GetObjectCommand|getSignedUrl\(" "${TARGET[@]}" | cut -c1-200 | head -25)
printf '%s\n' "${out:-   (no outbound service calls matched)}"
echo "   schedules:"
{
  for f in vercel.json netlify.toml wrangler.toml wrangler.json wrangler.jsonc render.yaml fly.toml; do
    [ -f "$f" ] && grep -nE '"?(schedule|cron|crons|path)"?[[:space:]]*[:=]' "$f" 2>/dev/null | sed "s#^#     $f:#"
  done
  [ -d .github/workflows ] && grep -nHE '^[[:space:]-]*cron:' .github/workflows/*.y*ml 2>/dev/null | sed 's#^#     #'
} | head -30 >"$WORK/sched"
if [ -s "$WORK/sched" ]; then cat "$WORK/sched"; else echo "     (none found)"; fi
note "cost = calls per run x runs per day x rows/users. Check loops, batching, rate limits, idempotency keys."

h "16. DRIFT - any / suppressions / TODO"
printf '   any: %s   ts-ignore/expect-error/nocheck: %s   eslint-disable: %s   TODO/FIXME/HACK: %s\n' \
  "$(search n "$TS_EXT" "(:|[[:space:]]as|<)[[:space:]]*any([^A-Za-z0-9_]|\$)" "${TARGET[@]}" | wc -l | tr -d ' ')" \
  "$(search n "$SRC_EXT" "@ts-(ignore|expect-error|nocheck)" "${TARGET[@]}" | wc -l | tr -d ' ')" \
  "$(search n "$SRC_EXT" "eslint-disable" "${TARGET[@]}" | wc -l | tr -d ' ')" \
  "$(search n "$SRC_EXT" "(TODO|FIXME|HACK)([^A-Za-z]|\$)" "${TARGET[@]}" | wc -l | tr -d ' ')"

printf '\n\n-- end of scan. Nothing above is a finding until you have read the file. --\n'
exit 0
