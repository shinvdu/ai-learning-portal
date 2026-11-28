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

/**
 * Client-side mirror of the API `MEDIA_MAX_BYTES` default (50MB). The server
 * remains authoritative; this only avoids a doomed upload over slow links.
 * Override at build time with `VITE_MEDIA_MAX_BYTES` when the API is tuned.
 */
export const MEDIA_MAX_BYTES = (() => {
  const raw = Number(import.meta.env?.VITE_MEDIA_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 50 * 1024 * 1024;
})();

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
  /** JSON-serialisable value, a raw string, FormData, or binary body. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Defaults to `same-origin`; use `omit` for cross-origin presigned PUTs. */
  credentials?: RequestCredentials;
  /** Do not dispatch the global `auth:unauthorized` event on 401. */
  suppressAuthEvent?: boolean;
};

export type BinaryBody = Blob | ArrayBuffer | ArrayBufferView;

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

/** Blob covers File; ArrayBufferView covers typed arrays and DataView. */
function isBinaryBody(value: unknown): value is BinaryBody {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof value === 'object' && value !== null && typeof ArrayBuffer !== 'undefined') {
    return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
  }
  return false;
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
    credentials: options.credentials ?? 'same-origin',
    headers,
    signal: options.signal,
  };

  if (options.body !== undefined) {
    if (isBinaryBody(options.body)) {
      // Raw uploads: the caller sets Content-Type explicitly (Blob.type is
      // ignored by fetch when the body is a plain Blob/ArrayBuffer).
      init.body = options.body as BodyInit;
    } else if (isFormData(options.body)) {
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

/* -------------------------------- uploads -------------------------------- */

export type UploadProgress = {
  loaded: number;
  total: number;
  /** 0–100, or `null` when the server does not report a total length. */
  percent: number | null;
};

export type UploadBinaryOptions = {
  /** Defaults to `PUT` (presigned S3/MinIO). Local uploads use `POST`. */
  method?: string;
  headers?: Record<string, string>;
  /** Defaults to `same-origin`; presigned S3 PUTs must use `omit`. */
  credentials?: RequestCredentials;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

function parseUploadPayload(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * XHR-backed binary upload with progress. `fetch` cannot report upload
 * progress, so media files use this instead. Resolves with the parsed JSON
 * success body (or `null` for an empty 2xx response such as S3 PUT).
 */
export function uploadBinary<T = unknown>(
  url: string,
  body: BinaryBody,
  options: UploadBinaryOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new ApiError(0, null, '当前浏览器不支持上传'));
      return;
    }

    const method = (options.method ?? 'PUT').toUpperCase();
    const xhr = new XMLHttpRequest();
    xhr.open(method, normaliseUrl(url), true);
    xhr.withCredentials =
      options.credentials === undefined ||
      options.credentials === 'same-origin' ||
      options.credentials === 'include';

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      try {
        xhr.setRequestHeader(name, value);
      } catch {
        // Browsers reject a few forbidden header names; ignore those.
      }
    }

    xhr.upload.onprogress = (event) => {
      if (!options.onProgress) return;
      const total = event.lengthComputable ? event.total : 0;
      const percent = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : null;
      options.onProgress({ loaded: event.loaded, total, percent });
    };

    const abort = (): void => {
      xhr.abort();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', abort, { once: true });
    }

    const cleanup = (): void => {
      if (options.signal) options.signal.removeEventListener('abort', abort);
    };

    xhr.onload = () => {
      cleanup();
      const payload = parseUploadPayload(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as T);
        return;
      }
      const errorPayload =
        typeof payload === 'string' ? payload : (payload as ApiErrorPayload | null);
      reject(
        new ApiError(
          xhr.status,
          errorPayload,
          messageFromPayload(errorPayload, xhr.status),
        ),
      );
    };

    xhr.onerror = () => {
      cleanup();
      reject(
        new ApiError(
          0,
          null,
          '上传失败：无法连接到存储服务，请检查网络或对象存储 CORS 配置',
        ),
      );
    };

    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    xhr.send(body as XMLHttpRequestBodyInit);
  });
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