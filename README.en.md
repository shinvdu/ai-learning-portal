# AI Learning Portal v2

**AI Learning & Data Analytics Portal** — a production-grade rewrite of the course catalog, course detail, chapter learning, knowledge center, learning dashboard and data-insights modules. Every KPI is computed from raw learning records in PostgreSQL: change one row and the metrics and charts move immediately.

[中文](README.md) · [Target architecture](docs/ARCHITECTURE_V2.md) · [Architecture decisions](docs/DECISIONS.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [Demo guide](docs/DEMO_GUIDE.md) · [Production readiness](docs/PRODUCTION_READINESS.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](#stack)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](#stack)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](#stack)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Version note**: `v2.2.0` is the current release (the v2.0.0 product-grade rewrite plus v2.1.0 P1 and the v2.2.0 media lifecycle), requiring Node ≥ 24 and container infrastructure. The `v1.2.0` tag remains permanently available as the zero-dependency, SQLite, single-file **offline teaching edition** — see [v1.2.0 offline edition](#c-v120-zero-dependency-offline-edition).
>
> All courses, chapters, quizzes and learning records are simulated. Pages and documents must not contain real names, accounts or company data.

---

## Contents

- [Features](#features)
- [Stack](#stack)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Metrics and golden values](#metrics-and-golden-values)
- [Security](#security)
- [API](#api)
- [Project layout](#project-layout)
- [Development and testing](#development-and-testing)
- [P1 capabilities and known limitations](#p1-capabilities-and-known-limitations)
- [License](#license)

---

## Features

- **Course catalog**: five course cards with category filters, keyword search and learner/completion/score stats.
- **Course detail**: intro, teacher, level, course video (inherit sample / custom / hidden) and a chapter list with inferred reach rates.
- **Chapter learning (30 chapters)**: lecture text, per-chapter video (inherit the course video or override it, HTTP Range seeking; hidden shows an empty state), chapter quiz, reach vs. the rest of the course, previous/next chapter.
- **Knowledge center**: summary, learning objectives, key points, glossary, FAQ, three quizzes with answers and explanations, source excerpts, and an AI-draft → human-edit comparison.
- **Learning dashboard**: five KPIs, six ECharts charts, course filter, dataset status; admins can expand the data playground.
- **Data insights**: records-driven insights, a metric formula table and common metric pitfalls.
- **Authentication**: email registration/login/logout, email verification, forgot/reset password, TOTP MFA with one-time recovery codes, per-account lockout.
- **Security**: Argon2id hashing (legacy scrypt upgrades transparently on login), PostgreSQL sessions (SHA-256 only), CSRF double-submit cookie + same-origin checks, Redis fixed-window rate limiting.
- **Admin area**: users (role/active/password/MFA/unlock), courses and chapters (course-level three-state video, per-chapter inherit/custom/hidden video), video and poster uploads (chunked/resumable, with progress and preview), a **media library** (object list, reference scan, delete/force-delete, orphan-cleanup dry run and execution), audit log, learning-record CRUD, CSV import/export and demo-data reset, plus **dataset snapshots**: every import/reset is snapshotted first and any snapshot can be restored with one click (a restore is itself reversible).
- **API docs**: an OpenAPI 3.1 spec generated from the zod contracts (`/api/v1/openapi.json`) and a Scalar reference UI (`/api/v1/docs`), gated in production by `ENABLE_API_DOCS`.
- **Media and mail**: course media on local disk or S3/MinIO (`STORAGE_DRIVER`), persisted as the stable site-local path `/api/v1/media/<key>`; large files use chunked/resumable uploads (8 MiB chunks, 2 GiB total cap by default) and the media library scans references, refuses deleting referenced objects, and cleans up orphans. Mail runs over webhook or built-in SMTP (`MAIL_TRANSPORT=smtp`).
- **Operations**: Docker Compose dev/prod stacks, Nginx TLS/SPA/rate limiting, `/healthz` and `/readyz`, structured logs with `X-Request-Id`, `pg_dump` backup and restore scripts.

## Stack

| Layer | Choice |
|---|---|
| API | Express 5 + TypeScript (ESM) + zod + pino + helmet |
| Web | Vue 3 + Vite + Vue Router 5 + Pinia + ECharts 6, hand-built CSS design system |
| Database | PostgreSQL 16 + Drizzle ORM (SQL migrations + advisory lock) |
| Cache / rate limiting | Redis 7 (fixed window; falls back to an in-process Map when Redis is down) |
| Password / MFA | `@node-rs/argon2` (Argon2id) + TOTP; MFA secrets encrypted with AES-256-GCM |
| Runtime | Node.js ≥ 24, npm workspaces |
| Delivery | Docker Compose + Nginx 1.27, optional systemd |

## Architecture

- Target architecture, module boundaries, data model and acceptance baseline: [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md)
- Key decisions and trade-offs (ADRs): [docs/DECISIONS.md](docs/DECISIONS.md)
- Canonical API prefix is `/api/v1`; the legacy `/api` alias delegates to the same router and adds `Deprecation` / `Link` headers.

```
Browser ──HTTPS──> Nginx (TLS/HSTS/static/SPA/edge rate limiting)
                     ├── /             -> Vue build output
                     ├── /api/v1/*     -> API (8787)
                     └── /healthz,/readyz -> API (internal only)
API ──> PostgreSQL 16 (sessions/users/courses/records/audit)
    └──> Redis 7 (rate-limit counters)
```

## Quick start

### A) Docker Compose production-shaped demo

`deploy/compose.prod.yml` publishes no PostgreSQL/Redis host ports and uses distinct volumes `portal_prod_pgdata` / `portal_prod_redisdata`, so it never touches the dev stack.

```bash
# 1. Copy and fill in the production template (replace every placeholder)
cp deploy/env.example deploy/.env.prod
chmod 600 deploy/.env.prod
#   - password inside DATABASE_URL, e.g. postgres://portal:<password>@postgres:5432/ai_portal
#   - POSTGRES_PASSWORD: same password as DATABASE_URL (used to initialise the DB)
#   - ADMIN_EMAIL / ADMIN_PASSWORD (first-run administrator)
#   - MFA_ENC_KEY: openssl rand -base64 32
#   - MAIL_TRANSPORT=webhook + MAIL_WEBHOOK_URL (console is rejected in production)

# 2. deploy/.env.prod also holds POSTGRES_PASSWORD; it must equal the password in
#    DATABASE_URL. Pass the file with --env-file so compose injects these values
#    into every service (otherwise DATABASE_URL etc. never reach the containers).
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod build
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod ps

# 3. Open http://127.0.0.1:8080 and sign in with ADMIN_EMAIL / ADMIN_PASSWORD
```

`migrate` → `seed` → `api` → `web` run in dependency order. The seed job passes `--demo-records`, so the 177 demo records are imported. For a real deployment remove that flag and set `SEED_DEMO_RECORDS` / `ALLOW_DEMO_RESET` to `0`. The compose `web` service listens on HTTP 8080 only; TLS belongs to the edge Nginx (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

> Production requires a usable mail transport. Without a relay, admin login and browsing still work, but registration/verification/password reset return `MAIL_FAILED`; configure `MAIL_WEBHOOK_URL` before a full demo.

### B) Local development

```bash
# 1. Start infrastructure (the dev compose only starts these two by default)
docker compose up -d postgres redis   # postgres 127.0.0.1:5433 / redis 127.0.0.1:6380

# 2. Install dependencies and export local env
npm ci
cp .env.example .env
set -a; . ./.env; set +a              # scripts do not load .env automatically

# 3. Migrate + seed (includes chapter video 0002 and media upload sessions 0003)
npm run db:migrate
npm run seed                          # dev imports the 177 demo records by default

# 4. Run API and Vite together
npm run dev
```

- Web: <http://127.0.0.1:5173> (Vite proxies `/api` to `http://127.0.0.1:8787`)
- API: <http://127.0.0.1:8787>, health at `/healthz` and `/readyz`
- API docs: <http://127.0.0.1:8787/api/v1/docs> (Scalar); spec at <http://127.0.0.1:8787/api/v1/openapi.json>. Open by default outside production; production requires `ENABLE_API_DOCS=1`.
- Default admin: `admin@example.com` / `change-me-before-use` (from `.env.example`, local only — change it before demoing)

API only: `npm run dev -w @portal/api`; web only: `npm run dev -w @portal/web`.

### C) v1.2.0 zero-dependency offline edition

The `v1.2.0` tag is the original zero-dependency Node.js + SQLite + vanilla frontend build, suited to classrooms without Docker, PostgreSQL or Redis:

```bash
git checkout v1.2.0
npm start          # no npm install needed; http://127.0.0.1:8787
# back to v2:
git checkout next
```

v1.2.0 stores data in `data/portal.db` (SQLite), fully separate from v2's PostgreSQL data; switching back does not touch v2 data.

## Metrics and golden values

Source: `packages/db/fixtures/learning_records.csv` (177 rows, 24 students, 5 courses, 2026-11-04 to 2026-11-17).

| Metric | Definition | Value |
|---|---|---|
| Students | distinct `student_id` | 24 |
| Courses | distinct `course_name` | 5 |
| Enrollments | unique `student_id + course_name` | 58 |
| Records | CSV row count | 177 |
| Average completion | per enrollment `max(chapters_done) / total_chapters`, then averaged | 74.3% |
| Average quiz score | scored enrollments only (missing ≠ 0) | 86.4 (53 scored / 5 unscored) |
| Total learning time | sum of `learning_minutes` ÷ 60 | 9,916 minutes / 165.3 hours |
| Chapters | 5 courses × 6 chapters | 30 |

Per course (learners / records / completion / average score):

- Generative AI Foundations: 11 / 32 / 81.8 / 87.0
- Prompt Engineering Basics: 16 / 47 / 81.3 / 88.3
- Python Data Analysis: 17 / 53 / 55.9 / 81.1
- Web Front-end Development: 6 / 23 / 76.2 / 86.2
- AI Safety & Responsible Use: 8 / 22 / 87.5 / 90.3

Chapter reach is **inferred** from total completed chapters and labeled as such in the UI; it is not per-chapter tracking data.

## Security

See [SECURITY.md](SECURITY.md) for the full model and reporting process. Highlights:

- Argon2id passwords; legacy scrypt hashes upgrade transparently after a successful login.
- Random session tokens; PostgreSQL stores only SHA-256 digests. Cookie `aip_session` is `HttpOnly` + `SameSite=Lax` + 7 days, with `Secure` added over HTTPS.
- One-time tokens (verification/reset/MFA challenge) **enforce expiry** (a v1 fix).
- MFA secrets are stored encrypted with AES-256-GCM using `MFA_ENC_KEY`; rotating the key invalidates existing MFA enrolments.
- CSRF double submit (`aip_csrf` cookie + `X-CSRF-Token`) plus same-origin checks for mutating requests that carry `Origin`.
- Redis fixed-window limits: public auth endpoints 20/IP/10 min; account-sensitive endpoints 10/user/10 min. Redis failure degrades to in-process counting.
- Append-only audit trail: auth, users, courses/chapters, record CRUD, CSV import/export, dataset reset, media upload/delete/cleanup.
- Production mode requires `ADMIN_PASSWORD`, `MFA_ENC_KEY`, `PUBLIC_BASE_URL` and a non-console mail transport; the process exits at startup otherwise.

## API

- Canonical prefix `/api/v1`; the legacy `/api` alias reuses the same router and only adds `Deprecation: true` and `Link: <...>; rel="successor-version"`.
- Cookies + CSRF, error envelope, pagination, the full endpoint tables, audit actions and examples are in [docs/API.md](docs/API.md).
- OpenAPI 3.1: `GET /api/v1/openapi.json` is always readable; the Scalar UI at `GET /api/v1/docs` is served outside production or when `ENABLE_API_DOCS=1`, otherwise 404. Media (`/media/{key}`, chunked uploads `/admin/media/uploads*`, media library `/admin/media`) and dataset-snapshot endpoints are part of the spec.

## Project layout

```
.
├── apps/
│   ├── api/                 Express 5 API, seed CLI, media/OpenAPI modules, SQLite importer, integration tests
│   │   └── Dockerfile       Debian slim + non-root; Argon2 prebuilt dependency
│   └── web/                 Vue 3 + Vite SPA
│       ├── nginx/           in-container HTTP static + /api proxy
│       └── Dockerfile       Vite build + nginx:1.27-alpine
├── packages/
│   ├── config/              env zod schema (dev defaults / prod validation)
│   ├── contracts/           request/response and audit-action zod contracts
│   ├── content/             lectures, chapters, quizzes, knowledge docs, pitfalls
│   ├── db/                  Drizzle schema, SQL migrations, fixtures, migration runner
│   └── domain/              pure functions: analytics/csv/totp/password/dates
├── deploy/
│   ├── compose.prod.yml     production stack (no PG/Redis host ports)
│   ├── env.example          production env template (placeholders)
│   ├── nginx/               edge TLS/HSTS/SPA/rate-limit example
│   └── systemd/             systemd unit
├── scripts/                 backup.sh / restore.sh / healthcheck.sh / import-sqlite.sh
├── e2e/                     Playwright smoke
├── docs/                    architecture, decisions, API, deployment, demo, readiness
├── compose.yml              dev stack (postgres 5433 / redis 6380; optional MinIO `media` profile)
└── package.json             npm workspaces scripts
```

## Development and testing

```bash
npm run typecheck     # tsc -b across all workspaces
npm run lint          # eslint
npm run build         # build every workspace (including the web bundle)
npm test              # Vitest: unit + API integration (needs PG/Redis)
npm run test:e2e      # Playwright smoke
```

- Integration tests create `ai_portal_test`, apply migrations and seed it; the development database is untouched.
- End-to-end demo steps and the acceptance checklist are in [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).
- Pre/post-release checklist: [docs/RELEASE_NOTES_v2.2.0.md](docs/RELEASE_NOTES_v2.2.0.md) and [docs/RELEASE_NOTES_v2.1.0.md](docs/RELEASE_NOTES_v2.1.0.md) (released).

## P1 capabilities and known limitations

P1 capabilities already released in v2.1.0: OpenAPI + Scalar (F036), CSV snapshots and restore (F064), SMTP (F049 extension), local/S3 media (F094), the admin media upload UI (F095), per-chapter video (F096), and the SQLite → PostgreSQL importer (F100).

`v2.2.0` adds:

- **Media library deletion and orphan cleanup (F097)**: `GET /admin/media` lists objects and scans course/chapter references; `DELETE /admin/media/:key` refuses referenced objects unless `force=1`; `POST /admin/media/cleanup` supports `dryRun` and a grace period and never deletes referenced objects or in-progress upload chunks; the admin area gains a "media library" tab. See [feature notes](docs/features/F097-media-delete-orphan-cleanup.md).
- **Chunked, resumable uploads (F098)**: a new `media_uploads` session table and `/admin/media/uploads*` endpoints; 8 MiB chunks and a 2 GiB total cap by default (configurable), staged under `MEDIA_DIR/.uploads`, expiring after 24 hours; S3 objects are assembled server-side then `PutObject`; the uploader supports progress, cancel and resume. See [feature notes](docs/features/F098-chunked-resumable-upload.md).

MinIO has passed the baseline live verification (RELEASE.2024-12-18: presigned PUT/GET + Range 206 and the course video reference); the browser upload UI has been re-verified with both the local driver and MinIO. Upgrading to `v2.2.0` **requires database migrations** (`0002_chapter_video.sql` + `0003_media_uploads.sql`, `npm run db:migrate`); migrate before seeding a fresh database too.

New environment variables (full defaults and production requirements in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)):

| Variable | Default | Purpose |
|---|---|---|
| `ENABLE_API_DOCS` | `0` | Opens `/api/v1/docs` in production; already open outside production |
| `MAIL_TRANSPORT` | `console` (dev) | `webhook` / `smtp` / `console`; `console` rejected in production |
| `SMTP_URL` | empty | Required for `MAIL_TRANSPORT=smtp`; `smtp://` or `smtps://` |
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `MEDIA_DIR` | `./data/media` | Local media directory; chunks are staged under `.uploads` |
| `MEDIA_MAX_BYTES` | `2147483648` (2 GiB) | Total chunked-upload cap; the legacy raw endpoint stays `min(this, 50 MiB)` |
| `MEDIA_CHUNK_SIZE` | `8388608` (8 MiB) | Chunk size |
| `MEDIA_UPLOAD_TTL_HOURS` | `24` | Upload-session and staged-chunk TTL |
| `MEDIA_ORPHAN_GRACE_HOURS` | `24` | Orphan-cleanup grace period |
| `VITE_MEDIA_MAX_BYTES` | empty (falls back to 2 GiB) | Build-time client-side upload cap hint; the server's `MEDIA_MAX_BYTES` remains authoritative |
| `MINIO_API_CORS_ALLOW_ORIGIN` | Vite dev origins | Dev-compose MinIO only; origins allowed to do direct browser PUT uploads. Configure separately for an external MinIO |
| `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | empty | Required for `STORAGE_DRIVER=s3`; credentials stay server-side |
| `S3_ENDPOINT` | empty | Required for MinIO (e.g. `http://127.0.0.1:9000`); optional for AWS |
| `S3_REGION` | `us-east-1` | S3 region |
| `S3_FORCE_PATH_STYLE` | `1` | MinIO needs path-style addressing |
| `S3_PUBLIC_URL` | empty | Optional public media domain; defaults to presigned URLs |

Still deferred: full Playwright matrix and coverage gates (CI runs a smoke suite). Also out of scope: SSO/OIDC/SAML, SCIM, multi-tenancy, resource-level permissions, audit retention/archival/WORM, metrics/tracing APM, enforced admin MFA, WAL/PITR, CSP nonces.

Risks and the definition of done: [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## License

[MIT](LICENSE) © 2026 AI Learning Portal contributors