#!/usr/bin/env bash
# Write FIELD_KEY -> {id, label} for every field as JSON, so render-report.sh can turn each
# "#<key>" in the report into a link to that field's admin page. Read-only.
#
#   id-map.sh [out.json]          default: .context/form-fields-audit/id-map.json
#
# Needs FIELDS_TABLE FIELD_PK FIELD_KEY FIELD_LABEL (env or $AUDIT_CONFIG).
set -euo pipefail

# shellcheck source=_db.sh
. "$(dirname "$0")/_db.sh"
audit_require FIELDS_TABLE FIELD_PK FIELD_KEY FIELD_LABEL
audit_ident FIELDS_TABLE FIELD_PK FIELD_KEY

OUT="${1:-.context/form-fields-audit/id-map.json}"
mkdir -p "$(dirname "$OUT")"

echo "id-map: reading $(audit_host) as a read-only session" >&2
audit_psql -A -t -c "
SELECT COALESCE(jsonb_pretty(jsonb_object_agg(($FIELD_KEY)::text, jsonb_build_object(
         'id', ($FIELD_PK)::text,
         'label', left(COALESCE(($FIELD_LABEL)::text, ''), 90)))), '{}')
FROM $FIELDS_TABLE;" | sed '/^$/d' > "$OUT"

echo "$OUT" >&2
