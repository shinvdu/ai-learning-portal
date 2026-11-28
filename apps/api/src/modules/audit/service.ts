/**
 * Audit service: best-effort writes that never break the request pipeline.
 *
 * Route agents should call `writeAudit(db, entry, logger)` or the convenience
 * `auditRequest(req, db, action, options)`. Failures are logged as warnings and
 * swallowed, exactly like v1's `auditRequest` helper.
 */
import type { Request } from 'express';
import type { Logger } from 'pino';
import type { Db } from '@portal/db';
import {
  insertAudit,
  listAudit,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
} from '../../db/repositories/audit.js';
import { clientIp } from '../../lib/ip.js';

export type { AuditEntry, AuditPage, AuditQuery };
export { listAudit };

function warn(logger: Logger | undefined, message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  if (logger) logger.warn({ err: detail }, message);
  else console.error(`[audit] ${message}: ${detail}`);
}

/** Insert an audit row; log and swallow any failure. */
export async function writeAudit(
  db: Db,
  entry: AuditEntry,
  logger?: Logger,
): Promise<void> {
  try {
    await insertAudit(db, entry);
  } catch (error) {
    warn(logger, 'write failed', error);
  }
}

export type AuditRequestOptions = {
  targetType?: string | null;
  targetId?: string | number | null;
  details?: Record<string, unknown> | null;
  actorEmail?: string | null;
  logger?: Logger;
};

/**
 * Write an audit row derived from the current request: actor, IP and (when the
 * caller does not override it) actor email come from `req.user`.
 */
export async function auditRequest(
  req: Request,
  db: Db,
  action: string,
  options: AuditRequestOptions = {},
): Promise<void> {
  const logger = options.logger ?? req.log;
  await writeAudit(
    db,
    {
      actorUserId: req.user?.id ?? null,
      actorEmail: req.user?.email ?? options.actorEmail ?? null,
      action,
      targetType: options.targetType ?? null,
      targetId: options.targetId ?? null,
      ip: clientIp(req),
      details: options.details ?? null,
    },
    logger,
  );
}

/** Convenience 0-argument variant for handlers that prefer try/finally. */
export function auditLogger(req: Request): Logger | undefined {
  return req.log;
}