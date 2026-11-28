/**
 * `/api/v1/admin/audit` (F065).
 *
 * Admin-only, newest-first (`id DESC`) paginated audit query with an optional
 * exact `action` filter. Default limit 50, max 200, offset >= 0. `details` is
 * returned as a parsed JSON object (never a raw string) so the admin UI can
 * render it directly.
 */
import { Router, type Request } from 'express';
import { appDeps } from '../../lib/types.js';
import { parsePagination, AUDIT_PAGINATION } from '../../lib/pagination.js';
import { listAudit } from './service.js';

export const auditRouter = Router();

function firstQuery(req: Request, name: string): string {
  const raw = req.query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : '';
}

/** v1 treats a zero/empty limit as absent (`Number(x) || default`). */
function paginationQuery(req: Request): Record<string, unknown> {
  const query = { ...req.query } as Record<string, unknown>;
  if (Number(firstQuery(req, 'limit')) === 0) delete query.limit;
  return query;
}

auditRouter.get('/', async (req, res) => {
  const { db } = appDeps(req);
  const pagination = parsePagination(paginationQuery(req), AUDIT_PAGINATION);
  const page = await listAudit(db, {
    limit: pagination.limit,
    offset: pagination.offset,
    action: firstQuery(req, 'action').trim(),
  });
  res.json(page);
});