#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  echo "缺少 .env；请先 cp .env.example .env 并填写本地开发值。" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
exec npm run dev
