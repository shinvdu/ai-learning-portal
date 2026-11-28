/**
 * Users repository (F041/F042/F043/F044/F048).
 *
 * Behaviour is a 1:1 port of the v1 SQLite helpers in `src/db.js` with two
 * intentional upgrades required by the v2 architecture:
 *
 * - login-failure increments take a row lock (`SELECT ... FOR UPDATE`) so
 *   concurrent failures are not lost;
 * - the last-active-admin guard runs under a transaction-scoped advisory lock,
 *   so two concurrent demotions/promotions can never leave zero admins.
 *
 * Password hashing happens in the service layer; every function here stores
 * and returns hashes verbatim. Email is normalised (trim + lower) on the way in
 * and `citext` guarantees case-insensitive uniqueness at the database level.
 */
import { createHash } from 'node:crypto';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { hashPassword } from '@portal/domain';
import {
  mfaRecoveryCodes,
  sessions,
  users,
  type Db,
  type UserRole,
} from '@portal/db';
import type { AdminUser } from '@portal/contracts';

/** Full users row (includes `password_hash` and `mfa_secret`). */
export type UserRow = typeof users.$inferSelect;

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  active?: boolean;
  emailVerified?: boolean;
};

export type UpdateUserPatch = {
  name?: string;
  role?: UserRole;
  active?: boolean;
  password?: string;
  unlock?: boolean;
  emailVerified?: boolean;
  resetMfa?: boolean;
};

export type UserMutationFailure = {
  ok: false;
  notFound?: boolean;
  errors: string[];
};

export type CreateUserResult = { ok: true; user: AdminUser } | UserMutationFailure;
export type UpdateUserResult = { ok: true; user: AdminUser } | UserMutationFailure;

/** Transaction-scoped advisory lock shared by every last-admin critical section. */
const ADMIN_GUARD_LOCK = 918_273_451;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

export function isEmail(email: unknown): boolean {
  const value = normalizeEmail(email);
  return value.length >= 5 && value.length <= 160 && EMAIL_PATTERN.test(value);
}

export function passwordProblem(password: unknown): string | null {
  const value = String(password ?? '');
  if (value.length < 8) return '密码至少需要 8 个字符';
  if (value.length > 200) return '密码过长';
  return null;
}

/** Convert a raw row to the safe admin-facing shape (v1 `listUsers`). */
export function toSafeUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    email_verified: Boolean(row.email_verified),
    mfa_enabled: Boolean(row.mfa_enabled),
    failed_attempts: row.failed_attempts,
    locked_until: row.locked_until ? row.locked_until.getTime() : null,
    created_at: row.created_at.toISOString(),
    last_login_at: row.last_login_at ? row.last_login_at.toISOString() : null,
  };
}

/** Full auth row by email (case-insensitive, normalised). */
export async function getByEmail(db: Db, email: string): Promise<UserRow | null> {
  const clean = normalizeEmail(email);
  if (!clean) return null;
  const [row] = await db.select().from(users).where(eq(users.email, clean)).limit(1);
  return row ?? null;
}

/** Full auth row by id. */
export async function getById(db: Db, id: number): Promise<UserRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/** Safe user rows ordered by id (v1 `listUsers`). */
export async function listUsers(db: Db): Promise<AdminUser[]> {
  const rows = await db.select().from(users).orderBy(users.id);
  return rows.map(toSafeUser);
}

type ValidatedUserInput = { errors: string[]; cleanName: string; cleanEmail: string };

function validateUserInput(
  input: { email?: string | undefined; name?: string | undefined; password?: string | undefined; role?: string | undefined },
  options: { creating: boolean },
): ValidatedUserInput {
  const errors: string[] = [];
  const cleanName = String(input.name ?? '').trim();
  const cleanEmail = normalizeEmail(input.email);

  if (cleanName.length < 1 || cleanName.length > 60) errors.push('姓名需要 1–60 个字符');
  if (options.creating || input.email !== undefined) {
    if (!isEmail(cleanEmail)) errors.push('邮箱格式不正确');
  }
  if (options.creating || input.password !== undefined) {
    const problem = passwordProblem(input.password);
    if (problem) errors.push(problem);
  }
  if (input.role !== undefined && input.role !== 'admin' && input.role !== 'learner') {
    errors.push('角色只能是 admin 或 learner');
  }
  return { errors, cleanName, cleanEmail };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

/**
 * Create a user (v1 `createUser`). Returns `{ok:false, errors}` for validation
 * and duplicate-email failures; never throws for expected input problems.
 */
export async function createUser(db: Db, input: CreateUserInput): Promise<CreateUserResult> {
  const role = input.role ?? 'learner';
  const validation = validateUserInput(
    { email: input.email, name: input.name, password: input.password, role },
    { creating: true },
  );
  if (validation.errors.length > 0) return { ok: false, errors: validation.errors };

  const existing = await getByEmail(db, validation.cleanEmail);
  if (existing) return { ok: false, errors: ['该邮箱已注册'] };

  const passwordHash = await hashPassword(String(input.password));
  let row: UserRow | undefined;
  try {
    [row] = await db
      .insert(users)
      .values({
        email: validation.cleanEmail,
        name: validation.cleanName,
        password_hash: passwordHash,
        role,
        active: input.active !== false,
        email_verified: input.emailVerified !== false,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, errors: ['该邮箱已注册'] };
    throw error;
  }
  if (!row) throw new Error('创建用户失败');
  return { ok: true, user: toSafeUser(row) };
}

export type UpdateUserOptions = {
  actingUserId?: number | null;
  /** Current session token; preserved when the actor updates their own password. */
  exceptToken?: string | null;
};

/**
 * Update a user (v1 `updateUser`).
 *
 * - `role`/`active` changes that remove the last active admin are rejected;
 * - an acting admin cannot demote or disable themselves;
 * - deactivation deletes every session for the target;
 * - a password change deletes every target session except the actor's current
 *   one (when the actor is the target and a token was supplied).
 */
export async function updateUser(
  db: Db,
  id: number,
  patch: UpdateUserPatch,
  options: UpdateUserOptions = {},
): Promise<UpdateUserResult> {
  const actingUserId = options.actingUserId ?? null;

  const passwordHash =
    patch.password !== undefined ? await hashPassword(String(patch.password)) : undefined;

  return db.transaction(async (tx) => {
    // Serialise last-admin checks across concurrent updates.
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_GUARD_LOCK})`);

    const [current] = await tx.select().from(users).where(eq(users.id, id)).for('update').limit(1);
    if (!current) return { ok: false, notFound: true, errors: ['用户不存在'] } as const;

    const nextRole: UserRole = patch.role !== undefined ? patch.role : current.role;
    const nextActive = patch.active !== undefined ? Boolean(patch.active) : Boolean(current.active);
    const nextName = patch.name !== undefined ? String(patch.name).trim() : current.name;

    const validation = validateUserInput(
      { name: nextName, password: patch.password, role: nextRole },
      { creating: false },
    );
    if (validation.errors.length > 0) return { ok: false, errors: validation.errors } as const;

    const isAdmin = current.role === 'admin' && current.active;
    const losingAdmin = isAdmin && (nextRole !== 'admin' || !nextActive);
    if (losingAdmin) {
      const [adminCount] = await tx
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.active, true)));
      if (Number(adminCount?.value ?? 0) <= 1) {
        return { ok: false, errors: ['不能移除最后一个启用的管理员'] } as const;
      }
      if (actingUserId === id) {
        return { ok: false, errors: ['不能降级或停用当前登录的管理员'] } as const;
      }
    }

    const patchSet: Partial<typeof users.$inferInsert> = {
      name: validation.cleanName,
      role: nextRole,
      active: nextActive,
    };
    if (passwordHash !== undefined) patchSet.password_hash = passwordHash;
    if (patch.unlock) {
      patchSet.failed_attempts = 0;
      patchSet.locked_until = null;
    }
    if (patch.emailVerified === true) patchSet.email_verified = true;
    if (patch.resetMfa) {
      patchSet.mfa_secret = null;
      patchSet.mfa_enabled = false;
    }

    const [updated] = await tx.update(users).set(patchSet).where(eq(users.id, id)).returning();
    if (!updated) return { ok: false, notFound: true, errors: ['用户不存在'] } as const;

    if (patch.resetMfa) {
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.user_id, id));
    }

    if (!nextActive) {
      // Deactivation revokes every session (v1 behaviour).
      await tx.delete(sessions).where(eq(sessions.user_id, id));
    } else if (passwordHash !== undefined) {
      const self = actingUserId === id;
      if (self && options.exceptToken) {
        await tx.delete(sessions).where(
          and(
            eq(sessions.user_id, id),
            ne(sessions.id, hashTokenForSession(options.exceptToken)),
          ),
        );
      } else if (!self) {
        await tx.delete(sessions).where(eq(sessions.user_id, id));
      }
      // Self password change without the current token: keep sessions so the
      // caller's existing cookie is not invalidated.
    }

    return { ok: true, user: toSafeUser(updated) } as const;
  });
}

/**
 * Local copy of the session-token digest rule (sessions repo exports it, but
 * importing it here would couple two repositories through a circular import in
 * some bundlers — the rule is a one-liner SHA-256 hex).
 */
function hashTokenForSession(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Record a successful login timestamp. */
export async function touchLogin(db: Db, id: number): Promise<void> {
  await db.update(users).set({ last_login_at: new Date() }).where(eq(users.id, id));
}

/**
 * Increment the shared password/MFA failure counter under a row lock. On the
 * fifth failure the counter is reset to 0 and a 15-minute lock is returned.
 */
export async function recordLoginFailure(db: Db, id: number): Promise<Date | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ failed_attempts: users.failed_attempts })
      .from(users)
      .where(eq(users.id, id))
      .for('update')
      .limit(1);
    if (!row) return null;

    const attempts = row.failed_attempts + 1;
    if (attempts >= LOCK_AFTER_FAILURES) {
      const lockedUntil = new Date(Date.now() + LOCK_MS);
      await tx
        .update(users)
        .set({ failed_attempts: 0, locked_until: lockedUntil })
        .where(eq(users.id, id));
      return lockedUntil;
    }
    await tx.update(users).set({ failed_attempts: attempts }).where(eq(users.id, id));
    return null;
  });
}

/** Clear failure counter and lock (success or admin unlock). */
export async function resetLoginFailures(db: Db, id: number): Promise<void> {
  await db
    .update(users)
    .set({ failed_attempts: 0, locked_until: null })
    .where(eq(users.id, id));
}

export async function markEmailVerified(db: Db, id: number): Promise<void> {
  await db.update(users).set({ email_verified: true }).where(eq(users.id, id));
}

export async function updatePasswordHash(db: Db, id: number, hash: string): Promise<void> {
  await db.update(users).set({ password_hash: hash }).where(eq(users.id, id));
}

/** Store an encrypted pending TOTP secret (MFA not yet enabled). */
export async function setPendingMfaSecret(db: Db, id: number, encryptedSecret: string): Promise<void> {
  await db
    .update(users)
    .set({ mfa_secret: encryptedSecret, mfa_enabled: false })
    .where(eq(users.id, id));
}

/** Enable MFA and replace the recovery-code set in one transaction. */
export async function enableMfa(db: Db, id: number, recoveryHashes: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfa_enabled: true }).where(eq(users.id, id));
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.user_id, id));
    if (recoveryHashes.length > 0) {
      await tx
        .insert(mfaRecoveryCodes)
        .values(recoveryHashes.map((codeHash) => ({ user_id: id, code_hash: codeHash })));
    }
  });
}

/** Disable MFA, clear the secret and delete recovery codes in one transaction. */
export async function disableMfa(db: Db, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ mfa_secret: null, mfa_enabled: false })
      .where(eq(users.id, id));
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.user_id, id));
  });
}