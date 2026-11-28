/**
 * Client address and transport helpers.
 *
 * `clientIp` prefers Express' `req.ip`, which honours `trust proxy` (set from
 * TRUST_PROXY in `app.ts`). `isSecureRequest` mirrors v1: TLS socket, or an
 * `X-Forwarded-Proto: https` header from a terminating proxy.
 */
import type { Request } from 'express';

export function clientIp(req: Pick<Request, 'ip' | 'socket'>): string | null {
  if (typeof req.ip === 'string' && req.ip.length > 0) return req.ip;
  const remote = req.socket?.remoteAddress;
  return typeof remote === 'string' && remote.length > 0 ? remote : null;
}

export function isSecureRequest(req: Pick<Request, 'headers' | 'socket' | 'secure'>): boolean {
  if (req.socket && 'encrypted' in req.socket && Boolean(req.socket.encrypted)) return true;
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return typeof value === 'string' && value.split(',')[0]?.trim().toLowerCase() === 'https';
}