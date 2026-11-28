#!/usr/bin/env bash
#
# Readiness probe for the AI Learning Portal v2 API (F034/F092).
#
# Calls `/healthz` (liveness) and `/readyz` (PostgreSQL + Redis + migrations)
# with curl and exits non-zero if either fails. Suitable for cron/CI/systemd
# ExecStartPost or a load-balancer probe from inside the network.
#
# Usage:
#   ./scripts/healthcheck.sh                     # http://127.0.0.1:8787
#   ./scripts/healthcheck.sh http://api:8787
#   HEALTHCHECK_BASE_URL=https://portal.example.com HEALTHCHECK_TIMEOUT=10 ./scripts/healthcheck.sh
#
set -Eeuo pipefail

BASE_URL="${HEALTHCHECK_BASE_URL:-${1:-http://127.0.0.1:8787}}"
TIMEOUT="${HEALTHCHECK_TIMEOUT:-5}"

log() { printf '[healthcheck] %s\n' "$*"; }
err() { printf '[healthcheck] error: %s\n' "$*" >&2; }

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: healthcheck.sh [BASE_URL]

Curls BASE_URL/healthz and BASE_URL/readyz; non-zero exit if either fails.

Environment:
  HEALTHCHECK_BASE_URL  Base URL (default: http://127.0.0.1:8787)
  HEALTHCHECK_TIMEOUT   Per-request curl --max-time seconds (default: 5)
USAGE
  exit 0
fi

command -v curl >/dev/null 2>&1 || { err "curl not found on PATH"; exit 1; }

if ! [[ "$TIMEOUT" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  err "HEALTHCHECK_TIMEOUT must be a number (got: $TIMEOUT)"
  exit 2
fi

# Trim any trailing slash so paths concatenate cleanly.
BASE_URL="${BASE_URL%/}"

failed=0
for path in /healthz /readyz; do
  url="$BASE_URL$path"
  if body="$(curl --silent --show-error --fail --max-time "$TIMEOUT" "$url")"; then
    log "ok   $path -> $body"
  else
    rc=$?
    err "FAIL $path ($url) exited $rc"
    failed=1
  fi
done

if (( failed != 0 )); then
  err "one or more health checks failed"
  exit 1
fi

log "all checks passed ($BASE_URL)"
exit 0