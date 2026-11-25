# Architecture

This document describes how AI Learning Portal is put together, how metrics are calculated, and where to extend it.

## Goals and non-goals

**Goals**

- A runnable, self-contained learning portal demo.
- Zero npm dependencies and zero build steps.
- Every number computed from the database, never hardcoded.
- Clear separation between data, analytics, API, and UI.
- Works offline (no CDN, no external fonts, no remote video).

**Non-goals**

- Authentication, authorization, multi-tenancy.
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
2. Schema is created with `CREATE TABLE IF NOT EXISTS`.
3. `syncCatalog()` upserts the 5 courses and their knowledge documents.
4. `syncChapters()` parses `data/lectures/*.txt`, splits by `第 N 章`, and rebuilds the `chapters` table.
5. If the `records` table is empty, `resetRecords()` imports `data/learning_records.csv`.
6. `server.js` starts listening on `PORT` / `HOST`.

Course and lecture changes require a restart. Record changes do not.

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
| `chapters_json` | TEXT | JSON array of chapter titles |
| `sort_order` | INTEGER | Catalog order |

Video metadata is attached at read time from `src/content.js` (see `getCourseMeta`), because it is presentation configuration rather than relational data.

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
  - hash router (`#/home`, `#/course/:id`, `#/chapter/:courseId/:idx`, `#/knowledge/:id`, `#/dashboard`, `#/insights`),
  - view renderers using template strings,
  - quiz state and scoring,
  - the editable data playground.
- `public/js/charts.js` generates SVG for column, horizontal bar, and line charts. `compact` mode switches to a smaller viewBox and fewer labels on narrow screens.
- All dynamic content is escaped with a small `esc()` helper before insertion.

### Why a hash router instead of a framework

Six views (five modules plus chapter pages), no shared complex state, no build step. Hash routing keeps deployment trivial and makes the demo work from any static host for the read-only views. A framework becomes worthwhile when authentication, complex forms, or many reusable components are added.

## Extending

### Add a course

1. Add an entry to `COURSES` in `src/content.js` (including `lectureFile`).
2. Add `data/lectures/<lectureFile>` with `第 1 章`, `第 2 章`, … headings.
3. Add a `KNOWLEDGE` entry.
4. Restart. The catalog and chapters are synced; add CSV rows for learning data.

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

`npm run verify` resets the seed data and checks:

- overall and per-course reference values,
- knowledge completeness and quiz validity,
- chapter counts, titles, body presence, monotonic reach rates,
- video and poster assets,
- chapter video configuration.

CI additionally syntax-checks ES modules and performs a server smoke test.

## Security model

This is a demo:

- no authentication,
- open write endpoints,
- simulated data only,
- CSP disallows inline scripts,
- all dynamic text is escaped,
- SQL is parameterized,
- imports are validated and transactional.

For a public deployment, add a read-only mode, authentication, rate limiting, and HTTPS termination at a reverse proxy.