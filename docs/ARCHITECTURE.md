# Architecture

This document describes how AI Learning Portal is put together, how metrics are calculated, and where to extend it.

## Goals and non-goals

**Goals**

- A runnable, self-contained learning portal demo.
- Zero npm dependencies and zero build steps.
- Every number computed from the database, never hardcoded.
- Clear separation between data, analytics, API, and UI.
- Demo-grade authentication with learner registration and an admin area for users, courses, and chapters.
- Works offline (no CDN, no external fonts, no remote video).

**Non-goals**

- Production-grade identity: email verification, password-recovery email, MFA, audit logs.
- Multi-tenancy or fine-grained permissions.
- Production-grade scale, caching, or background jobs.
- Real student data.
- A general-purpose LMS.

## Runtime overview

```text
Browser (vanilla ES modules, hash router, fetch, SVG)
        │  /api/*
        ▼
Node.js 24 http server (server.js)
        │  parameterized SQL, transactions
        ▼
SQLite (data/portal.db via node:sqlite)
        ▲
        └── first run: data/learning_records.csv (177 records)
            course catalog: src/content.js
            knowledge content: src/content.js
            chapter texts: data/lectures/*.txt (parsed at startup)
```

The server is a single process. Static files and the API are served from the same origin, so there is no CORS configuration.

## Startup sequence

1. `openDb()` creates `data/portal.db` if missing.
2. Schema is created with `CREATE TABLE IF NOT EXISTS`; lightweight migrations add new columns.
3. If the `courses` table is empty, `syncCatalog()` imports the initial courses and knowledge documents from `src/content.js`.
4. `syncChapters()` parses `data/lectures/*.txt` for courses that do not have chapters yet.
5. If the `records` table is empty, `resetRecords()` imports `data/learning_records.csv`.
6. `ensureAdminUser()` creates one admin account when no active admin exists. `ADMIN_EMAIL` / `ADMIN_PASSWORD` control it; otherwise a random password is generated and printed once.
7. `server.js` starts listening on `PORT` / `HOST`.

After the first run, the database is the source of truth for courses, chapters, users, and knowledge documents. Content-only changes in `src/content.js` no longer overwrite admin edits. Course/chapter changes made in the admin UI persist across restarts.

## Database schema

### `courses`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `C1` … `C5` |
| `name` | TEXT UNIQUE | Course name used by records |
| `category` | TEXT | Filter category |
| `teacher` | TEXT | Display only |
| `level` | TEXT | Display only |
| `badge` | TEXT | Short label for cards |
| `color` | TEXT | Accent color |
| `intro` | TEXT | Short description |
| `chapters_json` | TEXT | Legacy seed of chapter titles; live titles come from `chapters` |
| `video_json` | TEXT | Optional admin-configured video metadata; falls back to `src/content.js` |
| `sort_order` | INTEGER | Catalog order |

Course titles are read from the `chapters` table, so admin chapter edits are reflected immediately. Video metadata is `video_json` when set by an admin, otherwise the seed value from `src/content.js`.

### `records`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `student_id` | TEXT | Simulated IDs such as `S001` |
| `course_name` | TEXT | Must match a course |
| `learning_date` | TEXT | `YYYY-MM-DD` |
| `learning_minutes` | INTEGER | 0–1440 |
| `chapters_done` | INTEGER | Non-negative, ≤ `total_chapters` |
| `total_chapters` | INTEGER | > 0 |
| `quiz_score` | REAL NULL | `NULL` = not taken, not 0 |
| `created_at` | TEXT | SQLite timestamp |

Indexes exist on `course_name`, `student_id`, and `learning_date`.

### `chapters`

| Column | Type | Notes |
|---|---|---|
| `course_id` | TEXT | Part of composite PK |
| `idx` | INTEGER | Chapter number, 1-based |
| `title` | TEXT | Parsed from the lecture |
| `body` | TEXT | Raw lecture text for the chapter |

Chapters are rebuilt from `data/lectures/*.txt` on every startup.

### `knowledge`

| Column | Type | Notes |
|---|---|---|
| `course_id` | TEXT PK | |
| `payload_json` | TEXT | Summary, objectives, points, terms, FAQ, quiz, review, original excerpts |

Courses created in the admin UI have no knowledge document; the knowledge center shows an empty state.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `email` | TEXT UNIQUE COLLATE NOCASE | Normalized to lowercase |
| `name` | TEXT | Display name |
| `password_hash` | TEXT | `scrypt$salt$hash` (base64url) |
| `role` | TEXT | `admin` or `learner` |
| `active` | INTEGER | 0 disables login and deletes sessions |
| `created_at` | TEXT | |
| `last_login_at` | TEXT | |

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | SHA-256 of the random session token |
| `user_id` | INTEGER | FK to `users` |
| `expires_at` | INTEGER | Epoch milliseconds, 7 days |
| `created_at` | TEXT | |

### `meta`

Key/value store for dataset state: source, last update, seed import time, manual edit count.

## Metric definitions

The canonical implementation is in `src/analytics.js`. All API responses use it; the frontend only formats numbers.

### Enrollment grouping

A **enrollment** is a unique `student_id + course_name` pair. Multiple learning records for the same pair are grouped:

- `max_ch = MAX(chapters_done)`
- `total = MAX(total_chapters)`
- `minutes = SUM(learning_minutes)`
- `score = MAX(quiz_score)` among non-null scores
- `rate = max_ch / total`

### Overview

| Metric | Formula |
|---|---|
| Students | `COUNT(DISTINCT student_id)` |
| Courses | `COUNT(DISTINCT course_name)` |
| Enrollments | number of grouped enrollment rows |
| Avg. completion | `mean(enrollment.rate) * 100` |
| Avg. quiz score | `mean(enrollment.score)` over enrollments with a non-null score |
| Scored / missing | counts of non-null / null scores |
| Total hours | `SUM(learning_minutes) / 60` |

Rounding uses half-up at one decimal (81.25 → 81.3) and adds a tiny epsilon to counteract floating-point noise. This matches typical spreadsheet display.

### Per-course

`learners` is distinct students in the course. `records` is raw row count. Completion and score use the same enrollment grouping, filtered to the course.

### Daily trend and weekday

Daily data fills missing dates between the first and last record so the line chart is continuous. Weekday uses `getUTCDay()` on the date string so the result is timezone-independent.

### Distribution buckets

- Completion: 0–20%, 20–40%, 40–60%, 60–80%, 80–100%.
- Scores: <60, 60–70, 70–80, 80–90, 90–100.

### Insights

Insights are generated by rules over the computed dataset:

- highest learner count vs lowest completion,
- completion ≥80% vs <80% average score,
- weekday activity peak,
- missing-score impact,
- course score spread.

No insight text contains a hardcoded number; all values are interpolated from the current data. Insight text describes association, not causation.

## Chapter reach (inferred)

The source CSV has no per-chapter records. To give chapter pages meaningful data, the server computes:

```text
reached(chapter i) = enrollments where max_ch >= i
reachRate(i)       = reached / total enrollments
```

Consequences:

- Reach rates are monotonically non-increasing by chapter.
- The first chapter is always 100% for courses with records.
- The values are labelled “推断 / inferred” in the UI and must not be presented as raw data.
- For exact chapter analytics, add `chapter_id` (or a chapter-progress table) to the data source.

## Authentication and authorization

- Passwords: `scryptSync(password, randomSalt, 64)`, stored as `scrypt$salt$hash`; verification uses `timingSafeEqual`.
- Sessions: 256-bit random token in an `HttpOnly`, `SameSite=Lax`, 7-day cookie (`aip_session`). Only the SHA-256 digest is stored in `sessions`.
- The cookie adds `Secure` when `X-Forwarded-Proto: https` or the socket is TLS.
- `GET /api/auth/me` resolves the cookie on every request; expired or inactive-user sessions are deleted.
- Registration creates an active `learner`. Login and registration are rate-limited per IP (in-memory, fixed window).
- Mutating requests with a cross-site `Origin` are rejected.
- Admin bootstrap: when no active admin exists, create one from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, or generate a random password and print it once.
- Admin constraints: the last active admin cannot be demoted or disabled; an admin cannot demote or disable their own account. Disabling a user deletes their sessions.
- Authorization: public read APIs need no session; record writes and all `/api/admin/*` routes require `role = admin`.
- Admin course deletion refuses to remove a course that still has learning records unless `force=1`; force deletes the course and its records in one transaction. Renaming a course updates `records.course_name` in the same transaction.

## API design

- JSON for all data endpoints; no versioning (demo).
- Parameterized SQL everywhere.
- Write endpoints validate and return structured errors (`{ ok: false, errors: [...] }`).
- CSV import replaces the whole `records` table inside a transaction; validation happens before deletion.
- Static file serving supports a single `Range` header (HTTP 206) for video seeking.
- Responses include CSP and other security headers.

See the API table in the README for the route list.

## Frontend

- `public/index.html` is a shell: header, nav, `<main>`, footer.
- `public/js/app.js` contains:
  - hash router (`#/home`, `#/course/:id`, `#/chapter/:courseId/:idx`, `#/knowledge/:id`, `#/dashboard`, `#/insights`, `#/login`, `#/register`, `#/admin`, `#/admin/course/:id`),
  - view renderers using template strings,
  - quiz state and scoring,
  - the admin user/course/chapter editors,
  - the admin-only data playground.
- `public/js/charts.js` generates SVG for column, horizontal bar, and line charts. `compact` mode switches to a smaller viewBox and fewer labels on narrow screens.
- All dynamic content is escaped with a small `esc()` helper before insertion.

### Why a hash router instead of a framework

Six public views plus login, registration, and an admin area, with no build step. Hash routing keeps deployment trivial. The current state is still small enough for vanilla modules; a framework becomes worthwhile when the admin area grows many reusable forms, tables, and permission variants.

## Extending

### Add a course

**Through the admin UI (recommended):** sign in as an admin → 管理后台 → 新建课程. Add chapters in the course editor. New courses have no knowledge document until one is added in code/database.

**As seed content for a fresh database:** add an entry to `COURSES` in `src/content.js` (including `lectureFile`), add `data/lectures/<lectureFile>` with `第 1 章`, `第 2 章`, … headings, and add a `KNOWLEDGE` entry. This only imports when the `courses` table is empty; existing databases are not overwritten.

### Replace a video

- Course-level: edit `DEMO_VIDEO` in `src/content.js`.
- Chapter-level: add an override in `CHAPTER_VIDEOS` keyed by `'C3-4'`.
- Keep MP4/H.264 for broad browser support and watch the file size.

### Add a metric

1. Compute it in `src/analytics.js`.
2. Expose it in the relevant API payload.
3. Render it in `app.js` with a formula hint.
4. Add a regression check in `scripts/verify.js`.

## Testing

`npm run verify` creates a temporary SQLite database (it does not touch `data/portal.db`) and checks:

- overall and per-course reference values,
- knowledge completeness and quiz validity,
- chapter counts, titles, body presence, monotonic reach rates,
- video and poster assets,
- chapter video configuration.

CI additionally syntax-checks ES modules and performs a server smoke test.

## Security model

This is a demo with basic, self-contained authentication:

- scrypt password hashes, hashed session tokens, HttpOnly/SameSite cookies,
- admin/learner roles; record writes and admin routes require admin,
- rate limiting on login/register, same-origin checks on mutations,
- simulated data only,
- CSP disallows inline scripts; dynamic text is escaped,
- SQL is parameterized; CSV imports are validated and transactional.

It intentionally lacks email verification, password recovery email, MFA, audit logging, and multi-tenancy. For a public deployment, add those plus HTTPS and proxy-level rate limiting.