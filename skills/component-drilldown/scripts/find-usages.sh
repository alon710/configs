#!/usr/bin/env bash
# Find where a component, module, or symbol is imported and used.
#
# Usage (run from the repo root):
#   bash <skill-dir>/scripts/find-usages.sh src/components/ui/button.tsx [search-path ...]
#   bash <skill-dir>/scripts/find-usages.sh Button [search-path ...]
#
# Given a file, it resolves each import back to that file: relative ('./button',
# '../ui/button.js'), path aliases ('@/components/ui/button', '~/...', '#/...', '$lib/...'),
# and directory imports of an index file. Imports of a same-named module that resolve
# elsewhere are listed separately. Given a bare name, it lists files that mention the symbol.
# Search paths default to '.'. Uses ripgrep when installed, grep otherwise. Read-only.
# Portable to bash 3.2 (the macOS default).
set -o pipefail

usage() {
  echo "usage: find-usages.sh <path/to/file | SymbolName> [search-path ...]" >&2
  exit 1
}
[ $# -ge 1 ] || usage
arg="$1"
shift
ROOTS=("$@")
[ ${#ROOTS[@]} -gt 0 ] || ROOTS=(.)

have() { command -v "$1" >/dev/null 2>&1; }
HAVE_RG=0
have rg && HAVE_RG=1

EXCLUDE_DIRS=(node_modules .git dist build out .next .nuxt .svelte-kit .turbo .vercel .output .cache coverage vendor storybook-static .context)
EXT="ts,tsx,js,jsx,mjs,cjs,vue,svelte,astro,mdx"
TEST_RE='\.(test|spec|stories)\.[a-z]+$|(^|/)(__tests__|__mocks__|tests?|e2e|cypress|playwright)/'
Q="['\"]"
NQ="[^'\"]"

WORK=$(mktemp -d 2>/dev/null || mktemp -d -t find-usages)
trap 'rm -rf "$WORK"' EXIT

# search MODE PATTERN PATH...   MODE n = file:line:text, l = file names. Tests are included.
search() {
  local mode="$1" pat="$2" e d
  shift 2
  local args=()
  if [ "$HAVE_RG" = 1 ]; then
    case "$mode" in n) args=(-n -H --no-heading) ;; l) args=(-l) ;; esac
    for e in $(echo "$EXT" | tr ',' ' '); do args+=(-g "*.$e"); done
    for d in "${EXCLUDE_DIRS[@]}"; do args+=(-g "!**/$d/**"); done
    rg --color never "${args[@]}" -e "$pat" -- "$@" 2>/dev/null
  else
    case "$mode" in n) args=(-rnHE) ;; l) args=(-rlE) ;; esac
    for e in $(echo "$EXT" | tr ',' ' '); do args+=(--include="*.$e"); done
    for d in "${EXCLUDE_DIRS[@]}"; do args+=(--exclude-dir="$d"); done
    grep "${args[@]}" -e "$pat" -- "$@" 2>/dev/null
  fi | sed 's#^\./##'
}

is_test() { printf '%s\n' "$1" | grep -Eq "$TEST_RE"; }

# Absolute, symlink-free form of a path whose parent directory exists.
abs_path() {
  local d b
  d=$(dirname "$1")
  b=$(basename "$1")
  d=$(cd "$d" 2>/dev/null && pwd -P) || return 1
  case "$b" in
    .) echo "$d" ;;
    ..) dirname "$d" ;;
    *) echo "$d/$b" ;;
  esac
}

regex_escape() { printf '%s' "$1" | sed 's/[][\.^$*+?(){}|/]/\\&/g'; }
pascal() { printf '%s\n' "$1" | awk -F'[-_.]' '{s=""; for (i=1; i<=NF; i++) s = s toupper(substr($i,1,1)) substr($i,2); print s}'; }

knip_hint() {
  local pm=""
  if [ -f bun.lock ] || [ -f bun.lockb ]; then pm=bun
  elif [ -f pnpm-lock.yaml ]; then pm=pnpm
  elif [ -f yarn.lock ]; then pm=yarn
  elif [ -f package.json ]; then pm=npm
  fi
  if [ -n "$pm" ] && grep -Eq '"knip"[[:space:]]*:[[:space:]]*"' package.json 2>/dev/null; then echo "$pm run knip"
  elif [ -x node_modules/.bin/knip ]; then echo "node_modules/.bin/knip"
  else echo "knip (not installed here; search by hand instead)"
  fi
}

print_list() { if [ -s "$1" ]; then sed 's/^/  /' "$1"; else echo "  (none)"; fi; }

if [ -f "$arg" ]; then
  rel="${arg#./}"
  noext="${rel%.*}"
  base=$(basename "$noext")
  self_abs=$(abs_path "$rel")
  mods_abs=("$(abs_path "$noext")")
  mods_rel=("$noext")
  name="$base"
  if [ "$base" = index ]; then
    name=$(basename "$(dirname "$noext")")
    mods_abs+=("$(dirname "${mods_abs[0]}")")
    mods_rel+=("$(dirname "$noext")")
  fi

  echo "# File: $rel"
  echo
  echo "## Exports"
  {
    grep -Eo 'export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?(function\*?|const|let|var|class|interface|type|enum)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*' "$rel" | awk '{print $NF}'
    # export { A, B as C } blocks, single- or multi-line; the exported name is the alias.
    awk '/export[[:space:]]*(type[[:space:]]*)?\{/ {f = 1; buf = ""}
      f { buf = buf " " $0
          if ($0 ~ /\}/) { f = 0
            sub(/.*export[[:space:]]*(type[[:space:]]*)?\{/, "", buf); sub(/\}.*/, "", buf)
            n = split(buf, parts, ",")
            for (i = 1; i <= n; i++) { s = parts[i]; sub(/^[[:space:]]*(type[[:space:]]+)?/, "", s)
              if (s ~ / as /) sub(/.* as[[:space:]]+/, "", s); sub(/[[:space:]]*$/, "", s); if (s != "") print s } } }' "$rel"
  } | sort -u >"$WORK/exports"
  print_list "$WORK/exports"
  grep -Eq 'export[[:space:]]+default' "$rel" && echo "  (has a default export: consumers may import it under any name)"

  # JSX tags to count per consumer: PascalCase exports, plus the file-derived name for
  # default exports and single-file components (.vue/.svelte/.astro).
  syms=$(grep -E '^[A-Z]' "$WORK/exports" | tr '\n' '|')
  case "$rel" in *.vue | *.svelte | *.astro) syms="$syms$(pascal "$name")|$name|" ;; esac
  grep -Eq 'export[[:space:]]+default' "$rel" && syms="$syms$(pascal "$name")|"
  syms="${syms%|}"

  name_re=$(regex_escape "$name")
  pat="(from|import|require|mock)[[:space:]]*\(?[[:space:]]*${Q}${NQ}*/${name_re}(\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte|astro))?/?${Q}"
  search n "$pat" "${ROOTS[@]}" >"$WORK/cand"
  : >"$WORK/src"
  : >"$WORK/tests"
  : >"$WORK/other"
  while IFS= read -r line; do
    file=${line%%:*}
    rest=${line#*:}
    ln=${rest%%:*}
    text=${rest#*:}
    [ "$(abs_path "$file")" = "$self_abs" ] && continue
    spec=$(printf '%s\n' "$text" | sed -E "s/.*${Q}(${NQ}*\/${name_re}(\.[a-z]+)?\/?)${Q}.*/\1/")
    spec_noext=$(printf '%s\n' "$spec" | sed -E 's#/$##; s/\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte|astro)$//')
    kind=""
    case "$spec_noext" in
      .*)
        cand=$(abs_path "$(dirname "$file")/$spec_noext")
        for m in "${mods_abs[@]}"; do [ -n "$cand" ] && [ "$cand" = "$m" ] && kind=relative; done
        ;;
      *)
        tail="$spec_noext"
        case "${spec_noext%%/*}" in @* | '~'* | '#'* | '$'*) tail="${spec_noext#*/}" ;; esac
        for m in "${mods_rel[@]}"; do
          case "/$m" in */"$tail") kind=alias ;; esac
        done
        ;;
    esac
    if [ -z "$kind" ]; then
      echo "$file:$ln  $spec" >>"$WORK/other"
      continue
    fi
    uses=""
    if [ -n "$syms" ]; then
      uses="  (JSX tags: $(grep -cE "<(${syms})([[:space:]/>]|\$)" "$file" 2>/dev/null))"
    fi
    if is_test "$file"; then echo "$file:$ln$uses" >>"$WORK/tests"; else echo "$file:$ln$uses" >>"$WORK/src"; fi
  done <"$WORK/cand"

  echo
  echo "## Consumers: imports that resolve to this file ($(sort -u "$WORK/src" | wc -l | tr -d ' '))"
  sort -u "$WORK/src" >"$WORK/src.s"
  print_list "$WORK/src.s"
  echo
  echo "## Tests, stories, and mocks that import it (they break too when props change)"
  sort -u "$WORK/tests" >"$WORK/tests.s"
  print_list "$WORK/tests.s"
  if [ -s "$WORK/other" ]; then
    echo
    echo "## Same-name imports that did not resolve here"
    echo "   (a different module, or an alias this script cannot map: check tsconfig/jsconfig \"paths\" and bundler aliases)"
    sort -u "$WORK/other" | head -30 | sed 's/^/  /'
  fi
  echo
  if [ ! -s "$WORK/src.s" ]; then
    echo "No non-test consumers: dead-code candidate. Before deleting, confirm with: $(knip_hint)"
    echo "and rule out dynamic imports with computed paths, string-keyed registries, MDX, and external references."
  else
    echo "Read each consumer's JSX before changing a prop or variant."
  fi
else
  case "$arg" in
    */* | *.*) echo "no such file: $arg" >&2; exit 1 ;;
  esac
  printf '%s\n' "$arg" | grep -Eq '^[A-Za-z_$][A-Za-z0-9_$]*$' || { echo "not a file or identifier: $arg" >&2; exit 1; }
  sym_re=$(regex_escape "$arg")
  echo "# Symbol: $arg"
  echo
  echo "## Definitions"
  search n "(function\*?|const|let|var|class|interface|type|enum)[[:space:]]+${sym_re}([^A-Za-z0-9_\$]|\$)" "${ROOTS[@]}" | cut -c1-200 >"$WORK/defs"
  print_list "$WORK/defs"
  search n "(^|[^A-Za-z0-9_\$])${sym_re}([^A-Za-z0-9_\$]|\$)" "${ROOTS[@]}" \
    | awk -F: '{c[$1]++} END {for (f in c) printf "%4d  %s\n", c[f], f}' | sort -rn >"$WORK/refs"
  : >"$WORK/src"
  : >"$WORK/tests"
  while IFS= read -r line; do
    f=$(printf '%s\n' "$line" | awk '{print $2}')
    if is_test "$f"; then echo "$line" >>"$WORK/tests"; else echo "$line" >>"$WORK/src"; fi
  done <"$WORK/refs"
  echo
  echo "## Referenced in source (count  file)"
  print_list "$WORK/src"
  echo
  echo "## Referenced in tests / stories / mocks"
  print_list "$WORK/tests"
  echo
  echo "Text matches include same-named symbols from other modules. For import-resolved"
  echo "consumers, run again with the defining file's path."
fi
exit 0
