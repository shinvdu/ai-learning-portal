/**
 * Correlation id middleware (F093).
 *
 * A caller-supplied `X-Request-Id` is honoured only when it matches
 * `/^[A-Za-z0-9_-]{8,64}$/` (prevents header/log injection); otherwise a UUID
 * is generated. The id is attached to `req.requestId`, echoed in the
 * `X-Request-Id` response header and picked up by `pino-http`.
 */
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function resolveRequestId(header: unknown): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) return value;
  return randomUUID();
}

export const requestId: RequestHandler = (req, res, next) => {
  const id = resolveRequestId(req.headers['x-request-id']);
  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};