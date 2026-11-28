/**
 * Double-submit CSRF tokens (F045).
 *
 * The SPA reads the readable `aip_csrf` cookie and echoes it in the
 * `X-CSRF-Token` header on mutating requests. Non-browser clients (curl, CI)
 * do not send `Origin` and are not CSRF targets, so they are allowed through —
 * exactly the v1 behaviour. Comparison is length-checked then constant-time.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { CSRF_COOKIE_NAME } from '@portal/config';
import { parseCookies, serializeCsrfCookie } from './cookies.js';
import { isSecureRequest } from './ip.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingMethod(method: string | undefined): boolean {
  return MUTATING_METHODS.has(String(method ?? '').toUpperCase());
}

/** Read the CSRF cookie from the raw header (works before cookie-parser). */
export function readCsrfCookie(req: Pick<Request, 'headers'>): string | undefined {
  return parseCookies(req.headers.cookie)[CSRF_COOKIE_NAME];
}

export function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Return the existing CSRF token, or generate one and set the `aip_csrf`
 * cookie. Called by the static SPA handler and by `GET /auth/csrf`.
 */
export function ensureCsrfCookie(req: Request, res: Response): string {
  const existing = readCsrfCookie(req);
  if (existing) return existing;
  const token = generateCsrfToken();
  res.append('Set-Cookie', serializeCsrfCookie(token, { secure: isSecureRequest(req) }));
  // Make the freshly issued value visible to later middleware in this request.
  req.headers.cookie = req.headers.cookie
    ? `${req.headers.cookie}; ${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`
    : `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`;
  return token;
}

/**
 * True for safe methods, for requests without an `Origin` header (v1
 * behaviour), or when the cookie and header match.
 */
export function csrfValid(req: Pick<Request, 'method' | 'headers'>): boolean {
  if (!isMutatingMethod(req.method)) return true;
  if (!req.headers.origin) return true;

  const cookie = readCsrfCookie(req);
  const headerRaw = req.headers['x-csrf-token'];
  const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
  if (!cookie || !header) return false;

  const a = Buffer.from(cookie, 'utf8');
  const b = Buffer.from(String(header), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}