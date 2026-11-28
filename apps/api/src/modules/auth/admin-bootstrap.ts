/**
 * First-admin bootstrap (F048).
 *
 * On start-up, if there is no active admin, create one from
 * `ADMIN_EMAIL`/`ADMIN_PASSWORD` (or promote an existing account with that
 * email). Production requires an explicit password; development generates one
 * and returns it to the caller exactly once. Nothing is printed here — the
 * entry point logs only the email, and the generated password must never reach
 * production logs.
 *
 * The whole check runs in one transaction under a scoped advisory lock, so two
 * instances starting together cannot create duplicate bootstrap accounts or
 * race with a concurrent promotion.
 */
import { randomBytes } from 'node:crypto';
import { and, count, eq, sql } from 'drizzle-orm';
import { hashPassword } from '@portal/domain';
import { users, type Db } from '@portal/db';
import type { Env } from '@portal/config';
import type { Logger } from 'pino';
import { isEmail, normalizeEmail, passwordProblem } from '../../db/repositories/users.js';

export type BootstrapAdminResult = {
  created: boolean;
  email?: string;
  password?: string;
  generated?: boolean;
};

/** Advisory lock id for first-admin provisioning (distinct from last-admin). */
const BOOTSTRAP_LOCK = 918_273_452;

function production(env: Pick<Env, 'APP_ENV' | 'NODE_ENV'>): boolean {
  return env.APP_ENV === 'production' || env.NODE_ENV === 'production';
}

export async function bootstrapAdmin(deps: {
  db: Db;
  env: Env;
  logger: Logger;
}): Promise<BootstrapAdminResult> {
  const { db, env } = deps;
  const email = normalizeEmail(env.ADMIN_EMAIL);

  const configuredPassword = String(env.ADMIN_PASSWORD ?? '');
  if (production(env) && !configuredPassword) {
    throw new Error('生产环境必须设置 ADMIN_PASSWORD（至少 8 个字符）');
  }

  if (!isEmail(email)) throw new Error('ADMIN_EMAIL 不是合法邮箱');

  const generated = !configuredPassword;
  const password = configuredPassword || randomBytes(9).toString('base64url');
  const problem = passwordProblem(password);
  if (problem) throw new Error(`ADMIN_PASSWORD 不合规：${problem}`);

  const passwordHash = await hashPassword(password);

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);

    const [activeAdmins] = await tx
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true)));
    if (Number(activeAdmins?.value ?? 0) > 0) return false;

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      await tx
        .update(users)
        .set({ role: 'admin', active: true, password_hash: passwordHash })
        .where(eq(users.id, existing.id));
    } else {
      await tx.insert(users).values({
        email,
        name: 'Administrator',
        password_hash: passwordHash,
        role: 'admin',
        active: true,
      });
    }
    return true;
  });

  if (!created) return { created: false };
  return { created: true, email, password, generated };
}