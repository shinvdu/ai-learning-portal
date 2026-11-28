#!/usr/bin/env bash
#
# PostgreSQL backup for the AI Learning Portal v2 (F092).
#
# Creates a custom-format (`pg_dump -Fc`) dump, verifies it with
# `pg_restore --list`, prunes dumps older than RETENTION_DAYS and logs the
# resulting path and size. Exits non-zero on any failure and removes the partial
# file so a corrupt backup is never mistaken for a good one.
#
# Connection (first match wins):
#   DATABASE_URL=postgres://user:pass@host:port/db ./scripts/backup.sh
#   PGDATABASE=ai_portal PGHOST=... PGUSER=... PGPASSWORD=... ./scripts/backup.sh
#
# Environment:
#   BACKUP_DIR        Output directory (default: <repo>/backups)
#   RETENTION_DAYS    Delete `portal-*.dump` older than this (default: 14, 0 = keep)
#
# Usage:
#   ./scripts/backup.sh
#
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

log() { printf '[backup] %s\n' "$*"; }
err() { printf '[backup] error: %s\n' "$*" >&2; }

# Never echo a password embedded in a connection URI.
redact_url() {
  printf '%s' "$1" | sed -E 's#(://)[^/@]*@#\1***@#'
}

usage() {
  cat <<'USAGE'
Usage: backup.sh

Creates a verified pg_dump custom-format backup into BACKUP_DIR.

Environment:
  DATABASE_URL      Target database (or set PGDATABASE + PG* variables)
  BACKUP_DIR        Output directory (default: <repo>/backups)
  RETENTION_DAYS    Prune portal-*.dump older than N days (default: 14)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if (( $# > 0 )); then
  err "unexpected argument: $1"
  usage >&2
  exit 2
fi

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  err "RETENTION_DAYS must be a non-negative integer (got: $RETENTION_DAYS)"
  exit 2
fi

command -v pg_dump >/dev/null 2>&1 || { err "pg_dump not found on PATH"; exit 1; }
command -v pg_restore >/dev/null 2>&1 || { err "pg_restore not found on PATH"; exit 1; }

conn_args=()
db_label=""
if [[ -n "${DATABASE_URL:-}" ]]; then
  conn_args=(--dbname="$DATABASE_URL")
  db_label="$(redact_url "$DATABASE_URL")"
elif [[ -n "${PGDATABASE:-}" ]]; then
  # pg_dump/psql consume PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from the env.
  conn_args=()
  db_label="${PGDATABASE}"
else
  err "set DATABASE_URL, or PGDATABASE (plus the other PG* variables)"
  exit 2
fi

mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR" 2>/dev/null || true

stamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/portal-$stamp.dump"

cleanup() {
  local rc=$?
  if (( rc != 0 )); then
    rm -f -- "$target" 2>/dev/null || true
    err "backup failed (exit $rc); removed partial file"
  fi
}
trap cleanup EXIT

log "source:    $db_label"
log "target:    $target"
log "dumping..."

pg_dump "${conn_args[@]}" --format=custom --file="$target"

if [[ ! -s "$target" ]]; then
  err "pg_dump produced an empty file"
  exit 1
fi

if ! pg_restore --list "$target" >/dev/null 2>&1; then
  err "integrity check failed: $target is not a readable custom-format dump"
  exit 1
fi
log "integrity: pg_restore --list OK"

bytes="$(stat -c%s "$target" 2>/dev/null || wc -c <"$target")"
human="$(du -h -- "$target" | awk '{print $1}')"
log "size:      $human (${bytes} bytes)"
log "done:      backup written and verified"

if (( RETENTION_DAYS > 0 )); then
  pruned=0
  while IFS= read -r old; do
    [[ -z "$old" ]] && continue
    rm -f -- "$old"
    pruned=$((pruned + 1))
    log "pruned:    $old (older than ${RETENTION_DAYS}d)"
  done < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'portal-*.dump' \
      -mtime +"$RETENTION_DAYS" -print 2>/dev/null
  )
  if (( pruned == 0 )); then
    log "retention: nothing older than ${RETENTION_DAYS}d"
  fi
fi