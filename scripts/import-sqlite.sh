#!/usr/bin/env bash
#
# F100: SQLite (v1 data/portal.db) → PostgreSQL importer wrapper.
#
# Requires DATABASE_URL pointing at an already-migrated v2 database. The source
# SQLite file is opened read-only; nothing in it is modified.
#
# Usage:
#   DATABASE_URL=postgres://portal:portal@127.0.0.1:5433/ai_portal_test ./scripts/import-sqlite.sh --dry-run
#   DATABASE_URL=postgres://... ./scripts/import-sqlite.sh --wipe
#   DATABASE_URL=postgres://... ./scripts/import-sqlite.sh --include-sessions
#
# Options are passed through to `apps/api/src/importers/sqlite-to-pg.ts`.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: import-sqlite.sh [--db <path>] [--dry-run] [--wipe] [--include-sessions]

Imports the v1 SQLite database into PostgreSQL in one transaction.

Options:
  --db <path>          SQLite source file (default: <repo>/data/portal.db)
  --dry-run            Validate and print counts/discrepancies; write nothing
  --wipe               TRUNCATE the importer's target tables first (dangerous)
  --include-sessions   Also import unexpired sessions/auth_tokens
  -h, --help           Show this help

Environment:
  DATABASE_URL         Target PostgreSQL connection string (required)
  MFA_ENC_KEY          Key used to encrypt v1 plaintext MFA secrets

The SQLite file is always opened read-only. Run `npm run db:migrate` against
the target before importing.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '[import] error: DATABASE_URL is required (target PostgreSQL)\n' >&2
  usage >&2
  exit 2
fi

cd -- "$REPO_ROOT"

if [[ -x "$REPO_ROOT/node_modules/.bin/tsx" ]]; then
  exec "$REPO_ROOT/node_modules/.bin/tsx" \
    apps/api/src/importers/sqlite-to-pg.ts "$@"
fi

printf '[import] error: tsx is not installed (expected node_modules/.bin/tsx)\n' >&2
exit 1