# Contributing

Thanks for your interest in AI Learning Portal. This is a small demo project; contributions that keep it simple and dependency-free are especially welcome.

## Setup

- Node.js **≥ 24** (required for `node:sqlite`).
- No `npm install` is needed — there are no dependencies.

```bash
npm start       # http://127.0.0.1:8787
npm run dev     # restart on backend changes
npm run verify  # metrics + content + assets checks
```

`npm run verify` resets learning records to the seed CSV. Do not run it against a database you want to keep.

## Ground rules

1. **Keep zero runtime dependencies.** The project intentionally uses `node:http` and `node:sqlite` only.
2. **Keep zero build steps.** Frontend code is plain ES modules served directly.
3. **No hardcoded KPIs.** Every displayed number must be computed from the database.
4. **Do not commit real personal data.** Use simulated data only.
5. **Label inferences.** If data is derived (for example chapter reach), say so in the UI and docs.
6. **Escape dynamic text** inserted into HTML. Follow the existing `esc()` helper.

## Project conventions

- ES modules, 2-space indentation, single quotes.
- Chinese UI copy, English code identifiers and comments where practical.
- New API endpoints: return JSON, validate input, use parameterized SQL.
- New metrics: implement in `src/analytics.js`, expose via the API, render with a formula hint, and add a check in `scripts/verify.js`.
- New courses: update `src/content.js` and add a matching lecture file under `data/lectures/`.

## Testing

Before opening a PR:

```bash
npm run verify
node --check server.js
for f in src/*.js public/js/*.js scripts/*.js; do node --check "$f"; done
```

CI also performs a server smoke test.

## Pull requests

- Keep changes focused; one concern per PR.
- Describe **what** changed and **why**.
- Include screenshots for UI changes.
- Mention any data-format or schema changes.

## Commit messages

Conventional Commits are appreciated:

```text
feat: add chapter video placeholders
fix: exclude missing scores from averages
docs: explain inferred chapter reach
```

## Reporting issues

Use GitHub Issues for bugs and feature ideas. For security-sensitive reports, follow [SECURITY.md](SECURITY.md).