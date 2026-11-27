# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-28

### Added

- Email/password registration, login, logout, and `GET /api/auth/me`.
- scrypt password hashing, SQLite-backed sessions, HttpOnly/SameSite cookies, and per-IP rate limiting.
- Admin bootstrap via `ADMIN_EMAIL` / `ADMIN_PASSWORD`, with a generated password fallback.
- User management: create users, change roles, enable/disable accounts, reset passwords.
- Course management: course metadata, color, video, ordering; chapter create/edit/delete.
- Admin-only data playground and record-write APIs.
- Last-active-admin protection and automatic session invalidation on deactivation.

### Changed

- Course, chapter, and knowledge seed data is imported only on first run; the database becomes the source of truth.
- `npm run verify` now uses a temporary database and no longer resets the development database.
- Course chapter titles and video configuration are read from the database with seed fallbacks.

### Security

- Same-origin checks for mutating requests.
- Admin-only authorization on record writes, CSV import/export, and admin endpoints.
- Passwords and session tokens are never returned by the API or written to logs.

## [1.0.0] - 2026-11-25

### Added

- Course catalog, course detail, knowledge center, learning dashboard, and data insights.
- 30 chapter pages built from lecture texts, with a shared sample video, quizzes, and inferred chapter reach rates.
- Editable data playground: record CRUD, CSV import/export, and restore-to-seed.
- Zero-dependency Node.js HTTP server and SQLite data layer using `node:http` and `node:sqlite`.
- Vanilla ES-module frontend with hash routing and hand-written SVG charts.
- Responsive layouts and compact chart mode for narrow screens.
- HTTP Range support for sample video playback.
- Verification script covering metrics, content, chapters, and assets.
- CI workflow, architecture and demo documentation, and sample screenshots.

### Notes

- All student records, course texts, and videos are simulated/placeholder content.
- Chapter reach rates are inferred from total completed chapters and are labelled as such in the UI.