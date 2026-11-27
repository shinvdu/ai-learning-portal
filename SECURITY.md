# Security Policy

## Project status

AI Learning Portal is a **reference/demo project** that now includes a **single-node controlled production baseline**:

- email/password auth with scrypt hashing and hashed SQLite sessions,
- email verification and password reset through a mail webhook,
- TOTP MFA with one-time recovery codes,
- per-account login lockout and per-IP rate limiting,
- `admin` / `learner` roles; raw records and all admin endpoints require an admin,
- audit logging for auth, user, course/chapter, record, and CSV operations,
- CSRF double-submit cookies + same-origin checks,
- versioned migrations and `VACUUM INTO` backups.

It is still **not a public SaaS**: it does not have PostgreSQL/Redis multi-instance operation, SSO, SCIM, multi-tenancy, fine-grained permissions, audit retention/export, or a built-in SMTP client. Do not expose it to the public internet with real data without an additional review, HTTPS, proxy rate limiting, and data-protection controls.

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
- Login, registration, MFA, verification, reset, and recovery endpoints are rate-limited per IP.
- Per-account lockout after 5 failed password/MFA attempts (15 minutes); admin unlock.
- Email verification and reset tokens are random, stored only as SHA-256 digests, single-use, and time-limited (24h / 1h).
- Password reset and password change revoke existing sessions (except the current session for self-service change).
- TOTP secrets are stored in SQLite; recovery codes are stored as SHA-256 hashes and consumed on use.
- Audit log records authentication, role changes, password/MFA events, course/chapter changes, record CRUD, CSV import/export, reset, with actor and IP. Sensitive values (passwords/tokens) are not logged.
- Mutating requests require a same-site `Origin` and a CSRF double-submit token; non-browser clients without `Origin` are not CSRF targets.
- Admin-only checks on record reads/writes, CSV import/export, user management, course management, and audit access. Public pages expose only aggregated course/dashboard data.
- The last active admin cannot be demoted or disabled; an admin cannot demote or disable themselves.
- Deactivating a user deletes their sessions; resetting a password revokes all other sessions (the current session is kept when an admin changes their own password).
- Bootstrap admin credentials are validated (valid email, password at least 8 characters).
- Parameterized SQL for all queries.
- CSV import validation before replacing records, inside a transaction.
- HTML escaping for all dynamic text rendered by the frontend.
- Content-Security-Policy that disallows inline scripts.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Request body limit of 2 MB.
- No file uploads, no shell execution from user input.

## Public deployment checklist

- [ ] Set `APP_ENV=production`, `PUBLIC_BASE_URL`, `MAIL_WEBHOOK_URL`, and a strong `ADMIN_PASSWORD` before the first start.
- [ ] Put the app behind HTTPS and forward `X-Forwarded-Proto: https`; use the sample Nginx config.
- [ ] Keep `HOST=127.0.0.1`; expose only the proxy.
- [ ] Restrict the SQLite data directory to the service user; run `npm run backup` on a schedule and test restore.
- [ ] Do not import real student or company data until privacy/retention controls are in place.
- [ ] Review CSP / proxy headers for your environment; internal-only `/healthz` and `/readyz`.
- [ ] Configure proxy rate limits for auth endpoints; keep the application per-IP limits.
- [ ] Require MFA for admins operationally; the app supports it but does not enforce it.
- [ ] Add login alerting/retention/export requirements for your organisation.