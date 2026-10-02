# shellcheck shell=bash
# Shared, read-only connection setup for the audit scripts. Source it; do not run it.
#
# Config: plain KEY=value lines in $AUDIT_CONFIG (default .context/form-fields-audit/audit.env).
# A variable already set in the environment wins over the file. Values are taken literally
# (no shell expansion); one pair of surrounding quotes is stripped. No inline comments.
#
# The connection is AUDIT_DATABASE_URL and nothing else. There is deliberately no fallback to
# DATABASE_URL: in most apps that is the read-write URL, and sometimes it is production.

AUDIT_CONFIG="${AUDIT_CONFIG:-.context/form-fields-audit/audit.env}"
if [ -f "$AUDIT_CONFIG" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    case "$_line" in '' | '#'*) continue ;; esac
    _key="${_line%%=*}"
    case "$_key" in '' | *[!A-Za-z0-9_]*) continue ;; esac
    [ -n "${!_key+x}" ] && continue
    _val="${_line#*=}"
    case "$_val" in
      \"*\") _val="${_val#\"}"; _val="${_val%\"}" ;;
      \'*\') _val="${_val#\'}"; _val="${_val%\'}" ;;
    esac
    export "$_key=$_val"
  done < "$AUDIT_CONFIG"
  unset _line _key _val
fi

if [ -z "${AUDIT_DATABASE_URL:-}" ]; then
  echo "AUDIT_DATABASE_URL is not set (environment or $AUDIT_CONFIG)." >&2
  echo "Point it at a READ-ONLY role. DATABASE_URL is never used as a fallback." >&2
  exit 1
fi

STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-290s}"
case "$STATEMENT_TIMEOUT" in
  *[!0-9a-z]* | '') echo "STATEMENT_TIMEOUT must look like 290s, 60000 or 5min" >&2; exit 2 ;;
esac
ANSWERS_FILTER="${ANSWERS_FILTER:-true}"

# audit_require VAR... : fail unless every named config variable is set.
audit_require() {
  local v
  for v in "$@"; do
    [ -n "${!v:-}" ] || { echo "missing config: $v (write it in $AUDIT_CONFIG; see REFERENCE.md, Step 0)" >&2; exit 1; }
  done
}

# audit_ident VAR... : the value must be a plain (optionally schema-qualified) identifier,
# because it is spliced into SQL. Expressions belong in FIELD_LABEL / ANSWERS_FILTER only.
audit_ident() {
  local v
  for v in "$@"; do
    case "${!v}" in
      '' | *[!A-Za-z0-9_.]*) echo "$v must be a plain identifier, got '${!v}'" >&2; exit 2 ;;
    esac
  done
}

# Host only, never credentials - printed so the operator can see which database is being read.
audit_host() {
  local rest="${AUDIT_DATABASE_URL#*://}"
  rest="${rest#*@}"
  echo "${rest%%[:/?]*}"
}

# Every query runs in a read-only session with a raised statement timeout. The timeout is a
# SET statement rather than PGOPTIONS because some connection poolers reject startup options.
# -q keeps psql from printing the SET command tags into the output.
audit_psql() {
  psql "$AUDIT_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "SET default_transaction_read_only = on" \
    -c "SET statement_timeout = '$STATEMENT_TIMEOUT'" \
    "$@"
}

# Normalized label: HTML stripped, whitespace collapsed, lowercased. Takes a SQL expression.
audit_norm() {
  printf "lower(btrim(regexp_replace(regexp_replace(COALESCE((%s)::text,''),'<[^>]*>','','g'),'[[:space:]]+',' ','g')))" "$1"
}
