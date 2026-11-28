/**
 * Small helpers shared by the auth views (F080).
 *
 * - `safeRedirect` resolves a post-login destination from `?redirect=`, only
 *   accepting same-origin absolute paths (no protocol-relative or auth loops).
 * - `errorCode` pulls the API `code` (e.g. `EMAIL_UNVERIFIED`, `MAIL_FAILED`)
 *   out of an `ApiError` without losing the typed payload.
 */
import { ApiError } from '@/api/client';
import type { ClientUser } from '@/api/types';

export function safeRedirect(raw: unknown, user?: ClientUser | null): string {
  const fallback = user?.role === 'admin' ? '/admin' : '/';
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.startsWith('/login') || value.startsWith('/register')) return fallback;
  return value;
}

export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const { payload } = error;
  if (payload && typeof payload === 'object') return payload.code;
  return undefined;
}

/** Draft password rule shared by register/reset/change (v1 uses minlength 8). */
export const MIN_PASSWORD_LENGTH = 8;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `密码至少 ${MIN_PASSWORD_LENGTH} 个字符`;
  return null;
}