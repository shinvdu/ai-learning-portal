/**
 * Cookie parsing/serialisation that matches v1 semantics:
 *
 * - `aip_session`: Path=/, HttpOnly, SameSite=Lax, Max-Age=604800,
 *   Secure only when the request is secure.
 * - `aip_csrf`:    Path=/, readable by JS (no HttpOnly), SameSite=Lax,
 *   Max-Age=604800, Secure only when the request is secure.
 */
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '@portal/config';

export { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME };

export const CSRF_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type CookieOptions = { secure?: boolean };

/** Parse a `Cookie` request header into a name → value map. */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

export function serializeSessionCookie(token: string, options: CookieOptions = {}): string {
  const secure = options.secure ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearSessionCookie(options: CookieOptions = {}): string {
  const secure = options.secure ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function serializeCsrfCookie(token: string, options: CookieOptions = {}): string {
  const secure = options.secure ? '; Secure' : '';
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=${CSRF_COOKIE_MAX_AGE_SECONDS}${secure}`;
}

export function clearCsrfCookie(options: CookieOptions = {}): string {
  const secure = options.secure ? '; Secure' : '';
  return `${CSRF_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}