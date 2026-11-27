# Security Policy

## Project status

AI Learning Portal is a **demo/template project**, not a production LMS.

It has:

- demo-grade email/password authentication (scrypt + SQLite sessions),
- `admin` / `learner` roles; all write and admin endpoints require an admin,
- self-service learner registration,
- a single-process SQLite database,
- simulated student data only.

It does **not** have email verification, password-recovery email, MFA, audit logging, fine-grained permissions, or multi-tenancy. Do not deploy it directly to the public internet with real data. For a public demo, use HTTPS, set a strong admin password, and consider an additional auth proxy or read-only mode.

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

- Passwords hashed with `crypto.scryptSync` and a random per-user salt; verification uses `timingSafeEqual`.
- Session tokens are random 256-bit values; only a SHA-256 digest is stored in SQLite.
- Session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, 7-day expiry, and `Secure` when the request is HTTPS.
- Login and registration are rate-limited per IP.
- Mutating requests with a cross-site `Origin` are rejected.
- Admin-only checks on record writes, CSV import/export, user management, and course management.
- The last active admin cannot be demoted or disabled; an admin cannot demote or disable themselves.
- Deactivating a user deletes their sessions.
- Parameterized SQL for all queries.
- CSV import validation before replacing records, inside a transaction.
- HTML escaping for all dynamic text rendered by the frontend.
- Content-Security-Policy that disallows inline scripts.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Request body limit of 2 MB.
- No file uploads, no shell execution from user input.

## Public deployment checklist

- [ ] Put the app behind HTTPS and forward `X-Forwarded-Proto: https`.
- [ ] Set a strong `ADMIN_EMAIL` / `ADMIN_PASSWORD` before the first start; change it in the admin UI afterwards.
- [ ] Use a database path with restricted filesystem permissions.
- [ ] Do not import real student or company data.
- [ ] Back up `data/portal.db` if data matters.
- [ ] Review CSP / proxy headers for your environment.
- [ ] Rate-limit at the proxy layer if the login/register endpoints are internet-facing.
- [ ] Add email verification / password recovery / MFA if the deployment is more than a demo.