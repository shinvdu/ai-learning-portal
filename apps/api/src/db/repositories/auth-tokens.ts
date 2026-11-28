/**
 * Single-use auth tokens: email verification (24h), password reset (1h) and
 * MFA challenges (5min).
 *
 * Only the SHA-256 digest of the random token is stored; the raw token lives in
 * the email link or HTTP response only. `consumeAuthToken` redeems and marks a
 * token used in one atomic `UPDATE ... RETURNING`, and enforces `expires_at`
 * (the v1 "store but never check expiry" defect is intentionally fixed — see
 * ARCHITECTURE_V2 §2.7/2.10).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { authTokens, type AuthTokenType, type Db } from '@portal/db';

export type IssuedAuthToken = { token: string; expiresAt: Date };

export type AuthTokenRow = {
  id: string;
  user_id: number;
  type: AuthTokenType;
  expires_at: Date;
};

export function hashAuthToken(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Issue a token after deleting the previous unused token of the same
 * user+type, so only the newest link works.
 */
export async function issueAuthToken(
  db: Db,
  userId: number,
  type: AuthTokenType,
  ttlMs: number,
): Promise<IssuedAuthToken> {
  const token = randomBytes(32).toString('base64url');
  const id = hashAuthToken(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db.transaction(async (tx) => {
    await tx
      .delete(authTokens)
      .where(
        and(
          eq(authTokens.user_id, userId),
          eq(authTokens.type, type),
          isNull(authTokens.used_at),
        ),
      );
    await tx.insert(authTokens).values({ id, user_id: userId, type, expires_at: expiresAt });
  });

  return { token, expiresAt };
}

/**
 * Look up an unused token by hash. Does not filter by expiry; call
 * `consumeAuthToken` to enforce expiry atomically at redemption time.
 */
export async function findAuthToken(
  db: Db,
  token: string,
  type: AuthTokenType,
): Promise<AuthTokenRow | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      id: authTokens.id,
      user_id: authTokens.user_id,
      type: authTokens.type,
      expires_at: authTokens.expires_at,
    })
    .from(authTokens)
    .where(
      and(eq(authTokens.id, hashAuthToken(token)), eq(authTokens.type, type), isNull(authTokens.used_at)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Atomically redeem a token: mark it used only when it is still unused and
 * unexpired. Returns the owning user id, or null when invalid/expired/used.
 */
export async function consumeAuthToken(
  db: Db,
  token: string,
  type: AuthTokenType,
): Promise<{ user_id: number } | null> {
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .update(authTokens)
    .set({ used_at: now })
    .where(
      and(
        eq(authTokens.id, hashAuthToken(token)),
        eq(authTokens.type, type),
        isNull(authTokens.used_at),
        gt(authTokens.expires_at, now),
      ),
    )
    .returning({ user_id: authTokens.user_id });
  return row ?? null;
}

/**
 * Delete expired tokens and used tokens older than one day (v1
 * `purgeAuthTokens`).
 */
export async function purgeAuthTokens(db: Db): Promise<number> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const removed = await db
    .delete(authTokens)
    .where(or(lt(authTokens.expires_at, now), lt(authTokens.used_at, dayAgo)))
    .returning({ id: authTokens.id });
  return removed.length;
}

/** Count rows; exported for smoke/diagnostic use. */
export async function countAuthTokens(db: Db): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(authTokens);
  return Number(row?.value ?? 0);
}