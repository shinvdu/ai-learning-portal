/**
 * Append-only audit log repository (F047).
 *
 * The application only inserts and reads; there is no update/delete surface.
 * `details` is JSONB and is returned as an already-parsed object, matching the
 * v1 response where `details_json` was parsed before serialisation. Listing is
 * always `id DESC` with optional exact `action` filtering.
 */
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { auditLog, type Db } from '@portal/db';

export type AuditEntry = {
  actorUserId?: number | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  ip?: string | null;
  details?: Record<string, unknown> | null;
};

export type AuditQuery = {
  limit?: number;
  offset?: number;
  action?: string;
};

export type AuditRow = {
  id: number;
  created_at: string;
  actor_user_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
};

export type AuditPage = { total: number; limit: number; offset: number; rows: AuditRow[] };

/** Raw insert. Prefer `modules/audit/service.ts#writeAudit` for best-effort. */
export async function insertAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actor_user_id: entry.actorUserId ?? null,
    actor_email: entry.actorEmail ?? null,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId === undefined || entry.targetId === null ? null : String(entry.targetId),
    ip: entry.ip ?? null,
    details: entry.details ?? null,
  });
}

/** Paginated audit query, newest first. */
export async function listAudit(db: Db, query: AuditQuery = {}): Promise<AuditPage> {
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const offset = Math.max(0, query.offset ?? 0);
  const action = query.action?.trim();

  const where: SQL | undefined = action ? and(eq(auditLog.action, action)) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(auditLog)
    .where(where);
  const total = Number(totalRow?.value ?? 0);

  const rows = await db
    .select({
      id: auditLog.id,
      created_at: auditLog.created_at,
      actor_user_id: auditLog.actor_user_id,
      actor_email: auditLog.actor_email,
      action: auditLog.action,
      target_type: auditLog.target_type,
      target_id: auditLog.target_id,
      ip: auditLog.ip,
      details: auditLog.details,
    })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.id))
    .limit(limit)
    .offset(offset);

  return {
    total,
    limit,
    offset,
    rows: rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
      details: row.details ?? null,
    })),
  };
}