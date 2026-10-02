#!/usr/bin/env bash
# Wrap a curated findings fragment in the report shell and write one self-contained static HTML
# file. The fragment is your triaged analysis; this script only supplies the chrome, so every
# audit looks the same. No database access.
#
#   render-report.sh <body.html> [--title T] [--desc D] [--date YYYY-MM-DD]
#                    [--lang en] [--dir ltr|rtl|auto] [--out FILE]
#                    [--id-map map.json --link 'https://admin.example.com/fields/{id}']
#                    [--id-pattern '[0-9]+']
#
# Default output: ${AUDIT_OUT_DIR:-.context/form-fields-audit}/report-<date>.html (path printed).
# With --id-map and --link, every "#<key>" in the body becomes a link; {id} and {key} in the
# link template are filled from the map that id-map.sh writes.
set -euo pipefail

FRAG=""; TITLE="Form Fields Audit"; DATE="$(date +%Y-%m-%d)"
DESC="Prioritized audit of form fields: duplicates, dead fields, wrong types and missing validation, triaged by migration risk."
LANG_ATTR="en"; DIR_ATTR="ltr"; OUT=""; ID_MAP=""; LINK=""; ID_PATTERN="[0-9]+"

while [ $# -gt 0 ]; do
  case "$1" in
    --title)      TITLE="${2:?}"; shift 2 ;;
    --desc)       DESC="${2:?}"; shift 2 ;;
    --date)       DATE="${2:?}"; shift 2 ;;
    --lang)       LANG_ATTR="${2:?}"; shift 2 ;;
    --dir)        DIR_ATTR="${2:?}"; shift 2 ;;
    --out)        OUT="${2:?}"; shift 2 ;;
    --id-map)     ID_MAP="${2:?}"; shift 2 ;;
    --link)       LINK="${2:?}"; shift 2 ;;
    --id-pattern) ID_PATTERN="${2:?}"; shift 2 ;;
    -h|--help)    sed -n '2,13p' "$0"; exit 0 ;;
    -*)           echo "unknown option: $1" >&2; exit 2 ;;
    *)            FRAG="$1"; shift ;;
  esac
done

[ -n "$FRAG" ] && [ -f "$FRAG" ] || { echo "usage: render-report.sh <body.html> [options]  (--help)" >&2; exit 2; }
if { [ -n "$ID_MAP" ] && [ -z "$LINK" ]; } || { [ -z "$ID_MAP" ] && [ -n "$LINK" ]; }; then
  echo "--id-map and --link go together" >&2; exit 2
fi

SHELL_HTML="$(cd "$(dirname "$0")/.." && pwd)/assets/report-shell.html"
[ -f "$SHELL_HTML" ] || { echo "missing $SHELL_HTML" >&2; exit 1; }

if [ -z "$OUT" ]; then
  OUT_DIR="${AUDIT_OUT_DIR:-.context/form-fields-audit}"
  mkdir -p "$OUT_DIR"
  OUT="$OUT_DIR/report-$DATE.html"
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git check-ignore -q "$OUT"; then
    echo "  warning: $OUT is NOT git-ignored. Ignore $OUT_DIR, or pass --out into a mktemp -d dir." >&2
  fi
else
  mkdir -p "$(dirname "$OUT")"
fi

[ -n "$ID_MAP" ] || echo "  note: no --id-map/--link given, so ids stay plain text" >&2

python3 - "$SHELL_HTML" "$FRAG" "$OUT" "$TITLE" "$DESC" "$LANG_ATTR" "$DIR_ATTR" "$ID_MAP" "$LINK" "$ID_PATTERN" <<'PY'
import html, json, re, sys
from urllib.parse import quote

shell_path, frag, out, title, desc, lang, direction, id_map_path, link, id_pattern = sys.argv[1:11]

if direction not in ("ltr", "rtl", "auto"):
    raise SystemExit(f"--dir must be ltr, rtl or auto, got {direction!r}")
if not re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*", lang):
    raise SystemExit(f"--lang must be a language tag such as en or pt-BR, got {lang!r}")

shell = open(shell_path, encoding="utf-8").read()
body = open(frag, encoding="utf-8").read()

# Links were asked for, so a missing or broken map is a broken contract, not a cosmetic loss:
# a report of bare ids looks complete and is not. Fail loudly.
if id_map_path:
    try:
        id_map = json.load(open(id_map_path, encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"ERROR: id map not found at {id_map_path}. Run id-map.sh, or drop --id-map/--link.")
    except ValueError as exc:
        raise SystemExit(f"ERROR: id map at {id_map_path} is not valid JSON ({exc}).")
    if not isinstance(id_map, dict) or not id_map:
        raise SystemExit(f"ERROR: id map at {id_map_path} is empty or malformed.")
    if "{id}" not in link and "{key}" not in link:
        raise SystemExit("ERROR: --link must contain {id} or {key}.")

    token = re.compile(r"#(" + id_pattern + r")\b")
    parts = re.split(r"(<[^>]*>)", body)   # odd indices are tags - never touched
    in_anchor = False
    linked = 0
    unknown = set()
    for i, part in enumerate(parts):
        if i % 2:
            low = part.lower()
            if re.match(r"<a[\s>]", low):
                in_anchor = True
            elif low.startswith("</a"):
                in_anchor = False
            continue
        if in_anchor:
            continue

        def sub(m):
            global linked
            key = m.group(1)
            entry = id_map.get(key)
            if not isinstance(entry, dict) or "id" not in entry:
                unknown.add(key)
                return m.group(0)
            linked += 1
            href = link.replace("{id}", quote(str(entry["id"]), safe="")).replace("{key}", quote(key, safe=""))
            tip = html.escape(str(entry.get("label") or ""), quote=True)
            return (f'<a class="fid" href="{html.escape(href, quote=True)}" target="_blank" '
                    f'rel="noopener" title="{tip}">#{key}</a>')

        parts[i] = token.sub(sub, part)
    body = "".join(parts)
    print(f"  linked {linked} field ids", file=sys.stderr)
    if unknown:
        listed = " ".join("#" + k for k in sorted(unknown)[:20])
        print(f"  warning: {len(unknown)} id(s) not in the map, left unlinked: {listed}", file=sys.stderr)

values = {
    "TITLE": html.escape(title, quote=False),
    "DESCRIPTION": html.escape(desc, quote=True),
    "LANG": lang,
    "DIR": direction,
    "BODY": body,
}
missing = [k for k in values if "{{%s}}" % k not in shell]
if missing:
    raise SystemExit(f"shell is missing placeholder(s): {', '.join(missing)}")
# One pass, so text inserted from the body is never re-scanned for placeholders.
page = re.sub(r"\{\{(TITLE|DESCRIPTION|LANG|DIR|BODY)\}\}", lambda m: values[m.group(1)], shell)
open(out, "w", encoding="utf-8").write(page)

# Cheap structural check - an unbalanced fragment silently breaks the layout.
for tag in ("div", "section", "dl", "table", "details", "p"):
    o = len(re.findall(r"<%s[\s>]" % tag, body))
    c = len(re.findall(r"</%s>" % tag, body))
    if o != c:
        print(f"  warning: <{tag}> unbalanced in fragment ({o} open / {c} close)", file=sys.stderr)
PY

echo "$OUT"
