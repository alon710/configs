#!/usr/bin/env bash
# Decide whether two fields are one fact asked twice, or one label asked about different
# entities. Compares the RESPONDENTS of the two fields, not their labels. Read-only.
#
#   pair-overlap.sh <keep_key> <drop_key> [<keep_key> <drop_key> ...]
#
# Keys are FIELD_KEY values (the id a human sees). Needs, from the env or $AUDIT_CONFIG:
#   FIELDS_TABLE FIELD_PK FIELD_KEY FIELD_LABEL ANSWERS_TABLE ANSWER_FIELD_FK ANSWER_RESPONDENT
#   optional ANSWERS_FILTER - extra predicate on the answers table, e.g. deleted_at IS NULL
set -euo pipefail

[ $# -ge 2 ] && [ $(( $# % 2 )) -eq 0 ] || {
  echo "usage: pair-overlap.sh <keep_key> <drop_key> [<keep_key> <drop_key> ...]" >&2; exit 2; }

# shellcheck source=_db.sh
. "$(dirname "$0")/_db.sh"
audit_require FIELDS_TABLE FIELD_PK FIELD_KEY FIELD_LABEL ANSWERS_TABLE ANSWER_FIELD_FK ANSWER_RESPONDENT
audit_ident FIELDS_TABLE FIELD_PK FIELD_KEY ANSWERS_TABLE ANSWER_FIELD_FK ANSWER_RESPONDENT

VALUES=""
while [ $# -gt 0 ]; do
  for k in "$1" "$2"; do
    case "$k" in '' | *[!A-Za-z0-9_.:-]*) echo "key must be [A-Za-z0-9_.:-]+, got '$k'" >&2; exit 2 ;; esac
  done
  VALUES="${VALUES:+$VALUES,}('$1','$2')"
  shift 2
done

NORM="$(audit_norm "$FIELD_LABEL")"
# A derived table, not a CTE: a CTE referenced several times may be materialized, which would
# copy the whole answers table. This form is inlined and keeps the index on the field FK.
ANS="(SELECT $ANSWER_FIELD_FK AS pk, $ANSWER_RESPONDENT AS who FROM $ANSWERS_TABLE WHERE $ANSWERS_FILTER)"

echo "pair-overlap: reading $(audit_host) as a read-only session" >&2
audit_psql -c "
WITH pairs(keep_key, drop_key) AS (VALUES $VALUES),
f AS (SELECT ($FIELD_KEY)::text AS fkey, $FIELD_PK AS pk, ($FIELD_LABEL)::text AS lbl, $NORM AS norm
      FROM $FIELDS_TABLE),
m AS (
  SELECT p.keep_key, p.drop_key, fk.pk AS keep_pk, fd.pk AS drop_pk,
         fk.lbl AS keep_lbl, fd.lbl AS drop_lbl, (fk.norm = fd.norm) AS same_label,
         (SELECT count(DISTINCT a.who) FROM $ANS a WHERE a.pk = fk.pk) AS keep_n,
         (SELECT count(DISTINCT a.who) FROM $ANS a WHERE a.pk = fd.pk) AS drop_n,
         (SELECT count(DISTINCT a.who) FROM $ANS a
           WHERE a.pk = fk.pk AND EXISTS (SELECT 1 FROM $ANS b WHERE b.pk = fd.pk AND b.who = a.who)) AS overlap
  FROM pairs p
  LEFT JOIN f fk ON fk.fkey = p.keep_key
  LEFT JOIN f fd ON fd.fkey = p.drop_key)
SELECT keep_key, left(keep_lbl, 30) AS keep_label, drop_key, left(drop_lbl, 30) AS drop_label,
       keep_n, drop_n, overlap, (drop_n - overlap) AS rows_to_move,
       CASE
         WHEN keep_pk IS NULL OR drop_pk IS NULL
           THEN 'NOT FOUND - check both keys against FIELD_KEY'
         WHEN overlap < 0.02 * GREATEST(drop_n, 1)
           THEN 'DISJOINT - different eras of the form, near-lossless merge'
         WHEN overlap > 0.9 * GREATEST(LEAST(keep_n, drop_n), 1) AND same_label
           THEN 'DIFFERENT ENTITIES? - same label, same respondents. DO NOT MERGE on counts'
         WHEN overlap > 0.9 * GREATEST(LEAST(keep_n, drop_n), 1)
           THEN 'REDUNDANT - one fact asked of the same people two ways'
         ELSE 'MIXED - read sample answers from both sides before deciding'
       END AS verdict
FROM m;"

cat >&2 <<'EOF'

  DISJOINT           -> merge: move rows_to_move with the NOT EXISTS guard (REFERENCE.md, Case 2).
  REDUNDANT          -> the form asks one fact twice (date of birth AND birth year). The drop
                        side is removable; only rows_to_move respondents lose anything.
                        False positive to watch: a deliberate primary/secondary pair ("email" +
                        "additional email") looks exactly like this. Read both labels first.
  DIFFERENT ENTITIES -> an identical label answered by the same people almost always means one
                        question asked about several people or things (father / mother /
                        spouse, home / work address). Stop, unless the section context proves
                        it is the same field shown twice.
  MIXED              -> read sample answers from both sides first.

  Verdicts are a starting point, not a decision. Confirm against the section or group name and
  the surrounding fields before acting. Select fields also need an option map: if option ids
  are generated per field, a bare field-id swap corrupts every stored answer.
EOF
