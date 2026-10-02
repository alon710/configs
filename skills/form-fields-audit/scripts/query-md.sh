#!/usr/bin/env bash
# Run ONE read-only query and print the result as a markdown table, for the evidence file.
#
#   query-md.sh <query.sql> [--title "## 3. Unanswered fields"] [--note "what it measures"]
#   query-md.sh - <<'SQL'            # query on stdin
#   SELECT ...;
#   SQL
#
# Append the output to .context/form-fields-audit/evidence-<date>.md. Config: _db.sh.
set -euo pipefail

SRC=""; TITLE=""; NOTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --title) TITLE="${2:?}"; shift 2 ;;
    --note)  NOTE="${2:?}";  shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) SRC="$1"; shift ;;
  esac
done
[ -n "$SRC" ] || { echo "usage: query-md.sh <query.sql | -> [--title T] [--note N]" >&2; exit 2; }
[ "$SRC" = "-" ] || [ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 2; }

# shellcheck source=_db.sh
. "$(dirname "$0")/_db.sh"
echo "query-md: reading $(audit_host) as a read-only session" >&2

[ -z "$TITLE" ] || printf '%s\n\n' "$TITLE"
[ -z "$NOTE" ] || printf '%s\n\n' "$NOTE"

audit_psql --csv -f "$SRC" | python3 -c '
import csv, sys
rows = list(csv.reader(sys.stdin))
if not rows:
    print("_(no result set)_\n"); sys.exit(0)
def cell(v):
    return " ".join(v.split("\n")).replace("|", "\\|")
head, body = rows[0], rows[1:]
print("| " + " | ".join(cell(h) for h in head) + " |")
print("|" + "---|" * len(head))
for r in body:
    print("| " + " | ".join(cell(v) for v in r) + " |")
print()
if not body:
    print("_(0 rows)_\n")
'
