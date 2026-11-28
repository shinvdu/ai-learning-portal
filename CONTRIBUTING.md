# Contributing

Thanks for your interest in AI Learning Portal. This document covers the v2 monorepo (Express 5 API + Vue 3 web app + PostgreSQL + Redis). The zero-dependency `v1.2.0` offline edition is maintained by tag and receives best-effort fixes only.

## Setup

Requirements: Node.js **≥ 24**, npm, Docker (for PostgreSQL/Redis). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production.

```bash
# 1. Infrastructure (dev compose: postgres 5433, redis 6380)
docker compose up -d postgres redis

# 2. Dependencies
npm ci

# 3. Environment (scripts do not load .env automatically)
cp .env.example .env
set -a; . ./.env; set +a

# 4. Database
npm run db:migrate
npm run seed                 # dev imports the 177 demo records

# 5. Run API (8787) + Vite (5173)
npm run dev
```

## Verify before opening a PR

```bash
npm run typecheck            # tsc -b across workspaces
npm run lint                 # eslint
npm run build                # all workspaces + web bundle
npm test                     # Vitest unit + API integration (PG/Redis)
npm run test:e2e             # Playwright smoke
```

Integration tests create and use `ai_portal_test`; they must not touch the development database. If you add a metric or endpoint, extend the relevant test/golden assertion as well.

Useful targeted commands:

```bash
npm run test -w @portal/domain
npm run dev -w @portal/api
npm run dev -w @portal/web
npm run db:generate -w @portal/db   # generate a new SQL migration
```

## Ground rules

1. **No hardcoded KPIs.** Every displayed number must be computed from PostgreSQL via `@portal/domain`. Public pages must not inline metric values.
2. **No secrets or real data.** Use `.env.example` and placeholders. Never commit `.env`, `deploy/.env.prod`, dumps, credentials or real student/company data.
3. **Keep the API contract compatible.** Canonical paths live under `/api/v1`; the legacy `/api` alias must keep working. Error envelopes follow `{error, errors?, code?}`.
4. **Label inferences.** Derived data (for example chapter reach) must say so in the UI and docs.
5. **Docs stay accurate.** Commands and paths must match the repository; update [docs/API.md](docs/API.md) / [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) when behavior changes.
6. **Security-sensitive changes** need extra care: keep write/admin endpoints behind `requireAdmin`, never log passwords or tokens, keep CSRF/session behavior intact, and add tests for the boundary (401/403/CSRF).

## Project conventions

- TypeScript ESM, 2-space indentation, single quotes; Prettier config is checked in.
- Chinese UI copy; English identifiers and code comments where practical.
- Workspace boundaries: `packages/*` must not import from `apps/*`. Pure logic goes in `packages/domain` or `packages/content`; HTTP wiring in `apps/api`.
- New API endpoint: validate with zod (`packages/contracts`), return the standard envelope, add an integration test.
- New metric: implement in `packages/domain`, expose through the API, render with a formula hint, and add a golden assertion.
- New course/chapter content: use the admin UI for normal edits; seed content for a fresh database lives in `packages/content` and `packages/db/fixtures`.
- Database changes: update the Drizzle schema, run `npm run db:generate`, review the SQL, and never edit an already-applied migration in place.
- Frontend: use the existing CSS design tokens/components; do not add a UI framework.

## Pull requests

- Keep changes focused: one concern per PR.
- Describe **what** changed and **why**, and note any schema, API or config change.
- Include screenshots for UI changes and the commands/output used to verify.
- Ensure CI (`quality`, `test`, `e2e`) is green.
- Do not include tool/assistant attribution trailers or generated-by lines in commits, PR descriptions or code comments.

## Commit messages

Conventional Commits are appreciated:

```text
feat: add chapter video placeholders
fix: exclude missing scores from averages
docs: explain inferred chapter reach
```

## Reporting issues

Use GitHub Issues for bugs and feature ideas. For security-sensitive reports, follow [SECURITY.md](SECURITY.md) and do not open a public issue.