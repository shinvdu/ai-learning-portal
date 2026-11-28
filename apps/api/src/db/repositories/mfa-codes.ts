/**
 * MFA recovery codes (F043).
 *
 * Codes are stored as SHA-256 hashes of the normalised (`XXXX-XXXX`, uppercase,
 * no separators) form and burned with a single conditional UPDATE, so a code
 * can be redeemed at most once even under concurrent login attempts.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { mfaRecoveryCodes, type Db } from '@portal/db';

/** Replace a user's recovery codes (used by enable/reset flows). */
export async function replaceRecoveryCodes(
  db: Db,
  userId: number,
  codeHashes: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.user_id, userId));
    if (codeHashes.length > 0) {
      await tx
        .insert(mfaRecoveryCodes)
        .values(codeHashes.map((codeHash) => ({ user_id: userId, code_hash: codeHash })));
    }
  });
}

/**
 * Atomically consume one recovery code. Returns true only for the call that
 * actually transitioned a matching unused row to used.
 */
export async function consumeRecoveryCode(
  db: Db,
  userId: number,
  codeHash: string,
): Promise<boolean> {
  const [row] = await db
    .update(mfaRecoveryCodes)
    .set({ used_at: new Date() })
    .where(
      and(
        eq(mfaRecoveryCodes.user_id, userId),
        eq(mfaRecoveryCodes.code_hash, codeHash),
        isNull(mfaRecoveryCodes.used_at),
      ),
    )
    .returning({ id: mfaRecoveryCodes.id });
  return Boolean(row);
}

/** Delete every recovery code for a user (disable/reset). */
export async function deleteRecoveryCodes(db: Db, userId: number): Promise<void> {
  await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.user_id, userId));
}

/** Count unused codes (diagnostics). */
export async function countUnusedCodes(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.user_id, userId), isNull(mfaRecoveryCodes.used_at)));
  return Number(row?.value ?? 0);
}