#!/usr/bin/env bash
#
# PostgreSQL restore for the AI Learning Portal v2 (F092).
#
# Destructive: `pg_restore --clean --if-exists` drops matching objects in the
# target database before recreating them. The target is chosen by DATABASE_URL
# (or PGDATABASE + PG* variables); the script refuses to run without an explicit
# `--yes` or an interactive `restore` confirmation.
#
# Usage:
#   ./scripts/restore.sh backups/portal-20261128-120000.dump
#   ./scripts/restore.sh backups/portal-20261128-120000.dump --yes
#
# Environment:
#   DATABASE_URL      Target database (or set PGDATABASE + PG* variables)
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '[restore] %s\n' "$*"; }
err() { printf '[restore] error: %s\n' "$*" >&2; }

# Never echo a password embedded in a connection URI.
redact_url() {
  printf '%s' "$1" | sed -E 's#(://)[^/@]*@#\1***@#'
}

usage() {
  cat <<'USAGE'
Usage: restore.sh <dump-file> [--yes]

Restores a pg_dump custom-format backup with:
  pg_restore --clean --if-exists --no-owner --no-acl
then verifies row counts with psql.

  --yes, -y    Skip the interactive confirmation (for automation)

Environment:
  DATABASE_URL  Target database (or set PGDATABASE + PG* variables)
USAGE
}

dump=""
assume_yes=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --yes|-y) assume_yes=1 ;;
    -*) err "unknown option: $arg"; usage >&2; exit 2 ;;
    *)
      if [[ -n "$dump" ]]; then
        err "only one dump file may be given (got: $dump and $arg)"
        exit 2
      fi
      dump="$arg"
      ;;
  esac
done

if [[ -z "$dump" ]]; then
  err "missing dump file argument"
  usage >&2
  exit 2
fi

if [[ ! -e "$dump" ]]; then
  err "dump file not found: $dump"
  exit 2
fi
if [[ ! -f "$dump" || ! -r "$dump" ]]; then
  err "dump is not a readable regular file: $dump"
  exit 2
fi
if [[ ! -s "$dump" ]]; then
  err "dump file is empty: $dump"
  exit 2
fi
dump="$(cd -- "$(dirname -- "$dump")" && pwd)/$(basename -- "$dump")"

command -v pg_restore >/dev/null 2>&1 || { err "pg_restore not found on PATH"; exit 1; }
command -v psql >/dev/null 2>&1 || { err "psql not found on PATH"; exit 1; }

conn_args=()
db_label=""
if [[ -n "${DATABASE_URL:-}" ]]; then
  conn_args=(--dbname="$DATABASE_URL")
  db_label="$(redact_url "$DATABASE_URL")"
elif [[ -n "${PGDATABASE:-}" ]]; then
  conn_args=()
  db_label="${PGDATABASE}"
else
  err "set DATABASE_URL, or PGDATABASE (plus the other PG* variables)"
  exit 2
fi

if ! pg_restore --list "$dump" >/dev/null 2>&1; then
  err "integrity check failed: $dump is not a readable custom-format dump"
  exit 1
fi

cat >&2 <<EOF

!!!  DESTRUCTIVE RESTORE  !!!
    Target database: $db_label
    Dump file:       $dump
    pg_restore --clean --if-exists will DROP matching objects in the target
    database before recreating them. All current data in those objects is lost.

EOF

if (( assume_yes == 0 )); then
  printf "Type 'restore' to continue: "
  answer=""
  IFS= read -r answer || answer=""
  if [[ "$answer" != "restore" ]]; then
    err "aborted (confirmation not given)"
    exit 1
  fi
fi

log "restoring into $db_label ..."
pg_restore --clean --if-exists --no-owner --no-acl "${conn_args[@]}" "$dump"
log "pg_restore finished"

log "verifying row counts ..."
counts="$(
  psql "${conn_args[@]}" -v ON_ERROR_STOP=1 -tA -c \
    "select (select count(*) from courses) || '/' ||
            (select count(*) from chapters) || '/' ||
            (select count(*) from knowledge) || '/' ||
            (select count(*) from records);"
)"
records="$(psql "${conn_args[@]}" -v ON_ERROR_STOP=1 -tA -c 'select count(*) from records;')"

log "row counts (courses/chapters/knowledge/records): $counts"
log "records: $records"
log "done: restore complete and verified"