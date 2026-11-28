# Security Policy

## Project status

AI Learning Portal v2.0.0 is a **reference/demo project with a controlled production baseline** (single node or multiple stateless API instances behind Nginx). It includes:

- email/password authentication with **Argon2id** hashing (legacy scrypt upgrades on login),
- PostgreSQL-backed sessions where only a SHA-256 digest of the token is stored,
- email verification, password reset and one-time tokens with **enforced expiry**,
- TOTP MFA with one-time recovery codes; MFA secrets encrypted at rest (AES-256-GCM),
- per-account lockout and Redis-backed per-IP / per-user rate limiting,
- `admin` / `learner` roles; raw records and all admin endpoints require an admin session,
- append-only audit logging for auth, user, course/chapter, record and CSV operations,
- CSRF double-submit cookies plus same-origin checks,
- versioned SQL migrations and `pg_dump -Fc` backups.

It is still **not a public SaaS**: no SSO/SCIM, multi-tenancy, fine-grained/resource-level permissions, audit archival/WORM, enforced admin MFA, WAL/PITR, or built-in SMTP. Do not expose it to the public internet with real personal data without a privacy review, HTTPS, proxy rate limiting, patching and data-protection controls.

The `v1.2.0` tag remains the zero-dependency SQLite offline edition and receives best-effort fixes only.

## Supported versions

| Version | Supported |
|---|---|
| 2.x | Yes (current) |
| 1.x | Best effort (offline teaching edition) |
| < 1.0 | No |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's **private vulnerability reporting / Security Advisories** for this repository. Include:

- a description of the issue and potential impact,
- steps to reproduce,
- the affected endpoint, file or configuration,
- any suggested mitigation.

You can expect an initial response within a reasonable time for a volunteer-maintained project. Please allow time for a fix before public disclosure.

## Security measures in the codebase

### Authentication and sessions

- Passwords hashed with Argon2id (`@node-rs/argon2`, prebuilt native addon). Legacy `scrypt$...` hashes verify and are transparently re-hashed after a successful login.
- Session tokens are random 256-bit values; PostgreSQL stores only their SHA-256 digest. Sessions expire after 7 days and expired rows are purged at start-up.
- Session cookie `aip_session` is `HttpOnly`, `SameSite=Lax`, `Path=/`, 7-day expiry, and `Secure` whenever the request is HTTPS (honouring `X-Forwarded-Proto` behind a trusted proxy).
- Login, registration, MFA, email verification, resend, reset and forgot-password endpoints are rate-limited per IP (20 requests / 10 minutes). Password change, MFA enable and MFA disable are limited per user (10 / 10 minutes). Successful auth clears the corresponding bucket.
- Per-account lockout after 5 failed password/MFA attempts (15 minutes); admins can unlock.
- Email verification and reset tokens are random, stored only as SHA-256 digests, single-use, and time-limited (24 h / 1 h). Expiry is enforced; expired tokens cannot be redeemed.
- MFA challenge tokens are single-use and expire after 5 minutes.
- Password reset revokes all sessions. Password change revokes other sessions and keeps the current one. Enabling MFA revokes older password-only sessions.
- Deactivating a user revokes their sessions.

### MFA

- TOTP secrets are encrypted with AES-256-GCM before storage; key material comes from `MFA_ENC_KEY` (SHA-256-derived). Rotating the key invalidates existing MFA enrolments.
- Recovery codes are stored as SHA-256 digests and consumed on first use.
- Setup uses a pending secret; MFA is only enabled after a valid 6-digit code.
- Admins can reset a user's MFA from the user management API/UI.

### Authorization and data

- `admin` / `learner` roles. Admin APIs (`/admin/*`), record reads/writes, CSV import/export and audit access require an admin session; anonymous requests get 401 and learners get 403.
- Public pages return only aggregated catalog/dashboard data; raw learning records are never exposed publicly.
- The last active admin cannot be demoted or disabled; admins cannot demote or disable themselves.
- Parameterized SQL everywhere (Drizzle); CSV import is validated before a single transaction replaces the table.
- Course deletion with `force=1` deletes records → chapters → knowledge → course inside one transaction; without `force` it returns 409.
- Request body limit is 2 MB; there are no file uploads and no shell execution from user input.

### Web security

- CSRF double-submit: mutating browsers requests must echo the readable `aip_csrf` cookie in `X-CSRF-Token`; requests carrying `Origin` are additionally same-origin checked. Non-browser clients without `Origin` are not CSRF targets.
- API security headers via helmet; HTTPS edge example emits HSTS, CSP (no inline scripts), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP/CORP.
- Vue escapes interpolated text by default; no `v-html` on user-controlled content.
- SPA fallback only for extensionless GET/HEAD paths; unknown API paths return `404 {"error":"接口不存在"}`.

### Operations

- Structured pino logs with request IDs; cookies, `Authorization`, passwords, tokens and verification codes are redacted.
- `/healthz` and `/readyz` are intended for internal/loopback access only; the deployed Nginx sample denies public access.
- Audit log records actor, IP, action, target and selected details; passwords and tokens are never logged.
- Backup script uses `pg_dump -Fc`, verifies with `pg_restore --list`, removes partial files on failure, and defaults to a 14-day retention.

## Public deployment checklist

- [ ] `APP_ENV=production` and `NODE_ENV=production`; the API refuses to start without `DATABASE_URL`, `REDIS_URL`, `PUBLIC_BASE_URL`, `MFA_ENC_KEY` and `ADMIN_PASSWORD`.
- [ ] Strong, unique `ADMIN_PASSWORD`; `MFA_ENC_KEY` generated with `openssl rand -base64 32`; `MAIL_WEBHOOK_TOKEN` bearer secret.
- [ ] Terminate TLS at an edge proxy, forward `X-Forwarded-Proto: https`, and keep the API/web containers off the public network except through that proxy.
- [ ] Do not publish PostgreSQL/Redis ports (the production compose already enforces this).
- [ ] Use a non-console mail transport (`webhook` today) and verify SPF/DKIM/DMARC on the sending domain.
- [ ] Keep `/healthz` and `/readyz` internal-only; run `scripts/healthcheck.sh` from the private network.
- [ ] Schedule `scripts/backup.sh`, store dumps off-host, and test restore quarterly; record RPO/RTO.
- [ ] Enable MFA for admin accounts operationally (the app supports it but does not enforce it).
- [ ] Remove `--demo-records` from the production seed job and set `SEED_DEMO_RECORDS=0`, `ALLOW_DEMO_RESET=0`.
- [ ] Do not import real student or company data until privacy, retention, deletion and DPA requirements are in place; the SQLite → PostgreSQL importer is still P1.
- [ ] Patch Node.js/PostgreSQL/Redis/Nginx images and review `npm audit` on a schedule.
- [ ] Configure proxy and application rate limits for your expected traffic; monitor auth failures and audit events.