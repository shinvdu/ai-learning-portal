/**
 * Same-origin protection (F045).
 *
 * When a browser sends `Origin`, the host must equal the request `Host`;
 * otherwise the request is rejected before CSRF validation. Requests without
 * `Origin` (curl, server-to-server) are not browser-originated and pass.
 */
import type { Request } from 'express';

export function isSameOrigin(req: Pick<Request, 'headers'>): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(String(origin)).host === String(req.headers.host ?? '');
  } catch {
    return false;
  }
}