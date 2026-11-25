# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- No authentication is included; the project is a demo, not a production LMS.
- Chapter reach rates are inferred from total completed chapters and are labelled as such in the UI.