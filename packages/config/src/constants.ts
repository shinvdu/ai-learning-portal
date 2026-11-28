/** Canonical API prefix; the legacy `/api` alias mounts the same router. */
export const API_V1_PREFIX = '/api/v1';
export const LEGACY_API_PREFIX = '/api';

/* --------------------------------- time ---------------------------------- */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Absolute session lifetime (v1 cookies use 7 days). */
export const SESSION_TTL_MS = 7 * DAY_MS;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** One-time token lifetimes. */
export const VERIFY_TTL_MS = 24 * HOUR_MS;
export const RESET_TTL_MS = 1 * HOUR_MS;
export const MFA_CHALLENGE_TTL_MS = 5 * MINUTE_MS;

/* ------------------------------- rate limits ------------------------------ */

export const RATE_LIMIT_WINDOW_MS = 10 * MINUTE_MS;

/** Public auth endpoints: 20 requests per IP per 10 minutes. */
export const RATE_LIMIT_PUBLIC_AUTH_MAX = 20;

/** Authenticated account operations: 10 requests per user per 10 minutes. */
export const RATE_LIMIT_ACCOUNT_MAX = 10;

export const RATE_LIMIT_PUBLIC_AUTH = {
  max: RATE_LIMIT_PUBLIC_AUTH_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
} as const;

export const RATE_LIMIT_ACCOUNT = {
  max: RATE_LIMIT_ACCOUNT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
} as const;

/* ------------------------------- transport ------------------------------- */

/** Maximum JSON/CSV request body accepted by the API (2MB). */
export const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/* --------------------------------- cookies -------------------------------- */

export const SESSION_COOKIE_NAME = 'aip_session';
export const CSRF_COOKIE_NAME = 'aip_csrf';