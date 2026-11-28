/**
 * PostgreSQL session repository (ADR-004).
 *
 * A 256-bit random token is returned to the client inside the `aip_session`
 * cookie; only its SHA-256 hex digest is stored in `sessions.id`. Sessions have
 * an absolute 7-day lifetime (v1 semantics). Reads lazily delete expired rows
 * and rows whose user is inactive.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt, ne } from 'drizzle-orm';
import { sessions, users, type Db } from '@portal/db';
import { SESSION_TTL_MS } from '@portal/config';
import type { AuthUser } from '../../lib/types.js';

export type CreateSessionOptions = {
  ip?: string | null;
  userAgent?: string | null;
};

export type CreatedSession = { token: string; expiresAt: Date };

/**
 * The v2 `sessions` table stores only id/user_id/expires_at/created_at, so the
 * v1 `{ip, userAgent}` arguments are accepted for call-site compatibility but
 * are not persisted (see the final report for the schema gap).
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Db,
  userId: number,
  _options: CreateSessionOptions = {},
): Promise<CreatedSession> {
  // Accepted for call-site compatibility; the v2 schema does not persist IP/UA.
  void _options;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashSessionToken(token), user_id: userId, expires_at: expiresAt });
  return { token, expiresAt };
}

/** Resolve the session user; expired or inactive sessions are deleted. */
export async function getSessionUser(db: Db, token: string): Promise<AuthUser | null> {
  if (!token) return null;
  const id = hashSessionToken(token);
  const [row] = await db
    .select({
      expires_at: sessions.expires_at,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      active: users.active,
      email_verified: users.email_verified,
      mfa_enabled: users.mfa_enabled,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.user_id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;

  const expired = row.expires_at.getTime() <= Date.now();
  if (expired || !row.active) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: Boolean(row.email_verified),
    mfaEnabled: Boolean(row.mfa_enabled),
  };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}

/** Revoke every session for a user, optionally keeping the current token. */
export async function destroyUserSessions(
  db: Db,
  userId: number,
  options: { exceptToken?: string | null } = {},
): Promise<void> {
  const exceptToken = options.exceptToken;
  const where = exceptToken
    ? and(eq(sessions.user_id, userId), ne(sessions.id, hashSessionToken(exceptToken)))
    : eq(sessions.user_id, userId);
  await db.delete(sessions).where(where);
}

/** Delete expired session rows; returns the number removed. */
export async function purgeExpiredSessions(db: Db): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(lt(sessions.expires_at, new Date()))
    .returning({ id: sessions.id });
  return removed.length;
}