# Security Policy

## Project status

AI Learning Portal is a **demo/template project**, not a production LMS.

It has:

- no authentication or authorization,
- open write endpoints for demo data,
- a single-process SQLite database,
- simulated student data only.

Do not deploy it directly to the public internet with real data. For a public demo, place it behind a reverse proxy with authentication or add a read-only mode.

## Supported versions

| Version | Supported |
|---|---|
| 1.x | Yes (best effort) |
| < 1.0 | No |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's **private vulnerability reporting / Security Advisories** for this repository. Include:

- a description of the issue,
- steps to reproduce,
- affected endpoint or file,
- potential impact.

You can expect an initial response within a reasonable time for a volunteer-maintained demo.

## Security measures in the codebase

- Parameterized SQL for all queries.
- CSV import validation before replacing records, inside a transaction.
- HTML escaping for all dynamic text rendered by the frontend.
- Content-Security-Policy that disallows inline scripts.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Request body limit of 2 MB.
- No file uploads, no shell execution from user input.

## Public deployment checklist

- [ ] Put the app behind HTTPS.
- [ ] Add authentication or a read-only proxy for public demos.
- [ ] Use a database path with restricted filesystem permissions.
- [ ] Do not import real student or company data.
- [ ] Back up `data/portal.db` if data matters.
- [ ] Review CSP / proxy headers for your environment.
- [ ] Rate-limit write endpoints if they are exposed.