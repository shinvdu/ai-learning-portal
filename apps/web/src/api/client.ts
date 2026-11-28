/**
 * Thin fetch wrapper for `/api/v1`.
 *
 * - credentials: same-origin (session cookie `aip_session`, readable CSRF cookie)
 * - JSON by default; strings/FormData/Blob handled explicitly
 * - mutating requests echo the `aip_csrf` cookie in `X-CSRF-Token`; if the
 *   cookie is missing we fetch `GET /auth/csrf` once and retry
 * - failures throw `ApiError { status, payload, message }`
 * - 401 broadcasts `auth:unauthorized` so the auth store can clear itself
 *   (the client deliberately does not import the router, avoiding a cycle)
 */
import type { ApiErrorPayload } from './types';

export const API_BASE = '/api/v1';
export const CSRF_COOKIE_NAME = 'aip_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  readonly status: number;
  readonly payload: ApiErrorPayload | string | null;

  constructor(status: number, payload: ApiErrorPayload | string | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

/** Read the CSRF token, preferring the cookie over the in-memory fallback. */
export function readCsrfToken(): string {
  return readCookie(CSRF_COOKIE_NAME) || csrfTokenCache;
}

let csrfTokenCache = '';

/** `GET /auth/csrf` — issues/refreshes the readable cookie and returns it. */
export async function refreshCsrf(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/auth/csrf`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return '';
    const data = (await res.json().catch(() => null)) as { csrfToken?: string } | null;
    csrfTokenCache = data?.csrfToken ?? '';
  } catch {
    csrfTokenCache = '';
  }
  return csrfTokenCache;
}

/** Best-effort human message from an error payload. */
export function messageFromPayload(
  payload: ApiErrorPayload | string | null,
  status: number,
): string {
  if (typeof payload === 'string') {
    return payload.trim() || `请求失败（${status}）`;
  }
  if (payload && typeof payload === 'object') {
    if (payload.error) return payload.error;
    if (payload.errors && payload.errors.length > 0) return payload.errors[0] ?? `请求失败（${status}）`;
  }
  return `请求失败（${status}）`;
}

/** Normalise any thrown value into a user-facing message. */
export function errorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

export type RequestOptions = {
  method?: string;
  /** JSON-serialisable value, a raw string, or FormData. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Do not dispatch the global `auth:unauthorized` event on 401. */
  suppressAuthEvent?: boolean;
};

export type QueryValue = string | number | boolean | null | undefined;

/** Append defined query parameters to a path. */
export function withQuery(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

function normaliseUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/api/')) return path;
  return path.startsWith('/') ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function perform(
  path: string,
  options: RequestOptions,
  retried = false,
): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };
  const mutating = MUTATING_METHODS.has(method);

  let init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers,
    signal: options.signal,
  };

  if (options.body !== undefined) {
    if (isFormData(options.body)) {
      init.body = options.body;
    } else if (typeof options.body === 'string') {
      init.body = options.body;
    } else {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      init.body = JSON.stringify(options.body);
    }
  }

  let sentToken = '';
  if (mutating) {
    let token = readCsrfToken();
    if (!token) {
      token = await refreshCsrf();
    }
    if (token) {
      headers[CSRF_HEADER] = token;
      sentToken = token;
    }
    // Rebuild headers so the token lands in the request.
    init = { ...init, headers };
  }

  let response: Response;
  try {
    response = await fetch(normaliseUrl(path), init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, null, '网络连接失败，请检查网络后重试');
  }

  // A same-origin request with no CSRF token yet is likely a stale/absent
  // cookie. Fetch one and replay once.
  if (mutating && !sentToken && response.status === 403 && !retried) {
    await refreshCsrf();
    return perform(path, options, true);
  }

  if (!response.ok) {
    const payload = await parseBody(response);
    const errorPayload =
      typeof payload === 'string' ? payload : (payload as ApiErrorPayload | null);
    const error = new ApiError(
      response.status,
      errorPayload,
      messageFromPayload(errorPayload, response.status),
    );
    if (response.status === 401 && !options.suppressAuthEvent && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    throw error;
  }

  return response;
}

/** JSON request returning the parsed success body. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await perform(path, options);
  const payload = await parseBody(response);
  return payload as T;
}

/** Raw request for downloads; the caller owns the body stream. */
export async function apiRequestBlob(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await perform(path, options);
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : null;
  return { blob: await response.blob(), filename };
}