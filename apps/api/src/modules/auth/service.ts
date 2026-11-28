/**
 * Auth application service (F040–F044).
 *
 * Pure orchestration between the repositories, the domain primitives, the mail
 * adapter and the audit trail. Routes own HTTP concerns (cookies, rate limits,
 * status codes); this module owns the v1 decision order and the exact Chinese
 * messages/codes, so it can also be exercised directly from integration tests.
 */
import type { Logger } from 'pino';
import type { Db } from '@portal/db';
import type { Env } from '@portal/config';
import {
  MFA_CHALLENGE_TTL_MS,
  RESET_TTL_MS,
  VERIFY_TTL_MS,
} from '@portal/config';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hashPassword,
  otpauthUri,
  verifyPassword,
  verifyTotp,
} from '@portal/domain';
import { AUDIT_ACTION } from '@portal/contracts';
import type { AuthUser, Mailer } from '../../lib/types.js';
import { AppError, badGateway, badRequest, conflict, locked, unauthorized } from '../../lib/errors.js';
import { isProduction } from '../../config.js';
import {
  createSession,
  destroySession,
  destroyUserSessions,
  type CreatedSession,
} from '../../db/repositories/sessions.js';
import {
  consumeAuthToken,
  findAuthToken,
  issueAuthToken,
} from '../../db/repositories/auth-tokens.js';
import { consumeRecoveryCode } from '../../db/repositories/mfa-codes.js';
import {
  createUser,
  disableMfa,
  enableMfa,
  getByEmail,
  getById,
  markEmailVerified,
  recordLoginFailure,
  resetLoginFailures,
  setPendingMfaSecret,
  touchLogin,
  updatePasswordHash,
  type UserRow,
} from '../../db/repositories/users.js';
import { writeAudit } from '../audit/service.js';
import { passwordResetUrl, verificationUrl } from './mail.js';
import { createMfaCipher } from './mfa.js';

/** v1 wrote `auth.login_unverified`, which is absent from the released
 *  AUDIT_ACTIONS list; keep the historical name rather than renaming it. */
const AUDIT_LOGIN_UNVERIFIED = 'auth.login_unverified';

export type AuthServiceDeps = {
  db: Db;
  env: Env;
  logger: Logger;
  mailer: Mailer;
};

export type AuthContext = { ip?: string | null };

export type AuthOutcome = {
  status: number;
  body: Record<string, unknown>;
  session?: CreatedSession;
};

/** Session user shape; `active` is only present on login/register responses. */
export function clientUser(row: UserRow, options: { withActive?: boolean } = {}): Record<string, unknown> {
  const user: Record<string, unknown> = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: Boolean(row.email_verified),
    mfaEnabled: Boolean(row.mfa_enabled),
  };
  if (options.withActive) user.active = Boolean(row.active);
  return user;
}

function isLocked(row: Pick<UserRow, 'locked_until'>): boolean {
  return Boolean(row.locked_until && row.locked_until.getTime() > Date.now());
}

type AuditInput = {
  actorUserId?: number | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: number | string | null;
  details?: Record<string, unknown> | null;
};

async function audit(deps: AuthServiceDeps, ctx: AuthContext, entry: AuditInput): Promise<void> {
  await writeAudit(
    deps.db,
    {
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      targetType: entry.targetType === undefined ? 'user' : entry.targetType,
      targetId: entry.targetId ?? null,
      ip: ctx.ip ?? null,
      details: entry.details ?? null,
    },
    deps.logger,
  );
}

async function sendVerificationEmail(deps: AuthServiceDeps, user: UserRow): Promise<string> {
  const { token } = await issueAuthToken(deps.db, user.id, 'verify', VERIFY_TTL_MS);
  const url = verificationUrl(deps.env, token);
  await deps.mailer.send({
    to: user.email,
    subject: '验证你的邮箱 · AI Learning Portal',
    text: `你好 ${user.name}：\n\n请在 24 小时内打开以下链接验证邮箱：\n${url}\n\n如果不是你本人注册，请忽略此邮件。`,
  });
  return url;
}

async function sendPasswordResetEmail(deps: AuthServiceDeps, user: UserRow): Promise<string> {
  const { token } = await issueAuthToken(deps.db, user.id, 'reset', RESET_TTL_MS);
  const url = passwordResetUrl(deps.env, token);
  await deps.mailer.send({
    to: user.email,
    subject: '重置密码 · AI Learning Portal',
    text: `你好 ${user.name}：\n\n请在 1 小时内打开以下链接重置密码：\n${url}\n\n如果不是你本人操作，请忽略此邮件。`,
  });
  return url;
}

/* ------------------------------- register -------------------------------- */

export async function register(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  input: { name: string; email: string; password: string },
): Promise<AuthOutcome> {
  const production = isProduction(deps.env);
  const created = await createUser(deps.db, {
    name: input.name,
    email: input.email,
    password: input.password,
    role: 'learner',
    active: true,
    emailVerified: !production,
  });
  if (!created.ok) throw badRequest(created.errors[0] ?? '注册失败', created.errors);

  const user = await getByEmail(deps.db, created.user.email);
  if (!user) throw new Error('注册后读取用户失败');

  await audit(deps, ctx, {
    action: AUDIT_ACTION.AUTH_REGISTER,
    targetId: user.id,
    details: { email: user.email },
  });

  if (production) {
    try {
      await sendVerificationEmail(deps, user);
    } catch (error) {
      await audit(deps, ctx, {
        action: AUDIT_ACTION.AUTH_VERIFICATION_MAIL_FAILED,
        targetId: user.id,
        details: { message: error instanceof Error ? error.message : String(error) },
      });
      throw badGateway('账号已创建，但验证邮件发送失败，请稍后使用“重发验证邮件”', 'MAIL_FAILED');
    }
    return { status: 201, body: { verificationRequired: true, email: user.email } };
  }

  const session = await createSession(deps.db, user.id, { ip: ctx.ip });
  await touchLogin(deps.db, user.id);
  return { status: 201, body: { user: clientUser(user, { withActive: true }) }, session };
}

/* -------------------------------- login ---------------------------------- */

export async function login(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  input: { email: string; password: string },
): Promise<AuthOutcome> {
  const row = await getByEmail(deps.db, input.email);
  if (!row) {
    await audit(deps, ctx, {
      action: AUDIT_ACTION.AUTH_LOGIN_FAILED,
      actorEmail: input.email,
      targetType: null,
      targetId: null,
    });
    throw unauthorized('邮箱或密码错误');
  }
  if (!row.active) {
    await audit(deps, ctx, {
      action: AUDIT_ACTION.AUTH_LOGIN_INACTIVE,
      actorEmail: row.email,
      targetId: row.id,
    });
    throw unauthorized('邮箱或密码错误');
  }
  if (isLocked(row)) {
    await audit(deps, ctx, {
      action: AUDIT_ACTION.AUTH_LOGIN_LOCKED,
      actorEmail: row.email,
      targetId: row.id,
    });
    throw locked();
  }

  const verified = await verifyPassword(input.password, row.password_hash);
  if (!verified.valid) {
    const lockedUntil = await recordLoginFailure(deps.db, row.id);
    await audit(deps, ctx, {
      action: AUDIT_ACTION.AUTH_LOGIN_FAILED,
      actorEmail: row.email,
      targetId: row.id,
      details: lockedUntil ? { lockedUntil: lockedUntil.getTime() } : null,
    });
    if (lockedUntil) throw locked();
    throw unauthorized('邮箱或密码错误');
  }

  // Transparently upgrade legacy scrypt hashes after a successful check.
  if (verified.needsRehash) {
    await updatePasswordHash(deps.db, row.id, await hashPassword(input.password));
  }

  if (!row.email_verified) {
    await audit(deps, ctx, {
      action: AUDIT_LOGIN_UNVERIFIED,
      actorEmail: row.email,
      targetId: row.id,
    });
    throw new AppError(403, '请先验证邮箱后再登录', 'EMAIL_UNVERIFIED');
  }

  await resetLoginFailures(deps.db, row.id);

  if (row.mfa_enabled) {
    const challenge = await issueAuthToken(deps.db, row.id, 'mfa', MFA_CHALLENGE_TTL_MS);
    await audit(deps, ctx, {
      action: AUDIT_ACTION.AUTH_MFA_CHALLENGE,
      actorEmail: row.email,
      targetId: row.id,
    });
    return { status: 200, body: { mfaRequired: true, challengeToken: challenge.token } };
  }

  const session = await createSession(deps.db, row.id, { ip: ctx.ip });
  await touchLogin(deps.db, row.id);
  await audit(deps, ctx, {
    action: AUDIT_ACTION.AUTH_LOGIN,
    actorEmail: row.email,
    targetId: row.id,
  });
  return { status: 200, body: { user: clientUser(row, { withActive: true }) }, session };
}

/* ------------------------------ MFA login -------------------------------- */

export async function verifyMfa(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  input: { challengeToken: string; code: string },
): Promise<AuthOutcome> {
  const tokenRow = await findAuthToken(deps.db, input.challengeToken, 'mfa');
  if (!tokenRow || tokenRow.expires_at.getTime() <= Date.now()) {
    throw unauthorized('验证已过期，请重新登录');
  }

  const user = await getById(deps.db, tokenRow.user_id);
  if (!user || !user.active) throw unauthorized('账号不可用');
  if (isLocked(user)) throw locked();

  let totpValid = false;
  if (user.mfa_secret) {
    try {
      const secret = createMfaCipher(deps.env, deps.logger).decrypt(user.mfa_secret);
      totpValid = verifyTotp(secret, input.code);
    } catch {
      totpValid = false;
    }
  }
  const recoveryValid = totpValid
    ? false
    : await consumeRecoveryCode(deps.db, user.id, hashRecoveryCode(input.code));

  if (!totpValid && !recoveryValid) {
    const lockedUntil = await recordLoginFailure(deps.db, user.id);
    await audit(deps, ctx, {
      action: AUDIT_ACTION.AUTH_MFA_FAILED,
      actorEmail: user.email,
      targetId: user.id,
      details: lockedUntil ? { lockedUntil: lockedUntil.getTime() } : null,
    });
    if (lockedUntil) throw locked();
    throw unauthorized('验证码不正确');
  }

  // Redeem the 5-minute challenge only when it is still unused and unexpired.
  const redeemed = await consumeAuthToken(deps.db, input.challengeToken, 'mfa');
  if (!redeemed) throw unauthorized('验证已过期，请重新登录');

  await resetLoginFailures(deps.db, user.id);
  const session = await createSession(deps.db, user.id, { ip: ctx.ip });
  await touchLogin(deps.db, user.id);
  await audit(deps, ctx, {
    action: AUDIT_ACTION.AUTH_LOGIN_MFA,
    actorEmail: user.email,
    targetId: user.id,
  });
  return { status: 200, body: { user: clientUser(user, { withActive: true }) }, session };
}

/* ------------------------------ email verify ------------------------------ */

export async function verifyEmail(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  input: { token: string },
): Promise<AuthOutcome> {
  const tokenRow = await findAuthToken(deps.db, input.token, 'verify');
  if (!tokenRow) throw badRequest('验证链接无效或已过期');

  const user = await getById(deps.db, tokenRow.user_id);
  if (!user || !user.active) throw badRequest('账号不可用');

  const redeemed = await consumeAuthToken(deps.db, input.token, 'verify');
  if (!redeemed) throw badRequest('验证链接无效或已过期');

  await markEmailVerified(deps.db, user.id);
  await resetLoginFailures(deps.db, user.id);
  const fresh = (await getById(deps.db, user.id)) ?? user;

  await audit(deps, ctx, {
    action: AUDIT_ACTION.AUTH_EMAIL_VERIFIED,
    actorEmail: user.email,
    targetId: user.id,
  });

  if (fresh.mfa_enabled) {
    const challenge = await issueAuthToken(deps.db, fresh.id, 'mfa', MFA_CHALLENGE_TTL_MS);
    return {
      status: 200,
      body: {
        user: clientUser(fresh, { withActive: true }),
        mfaRequired: true,
        challengeToken: challenge.token,
      },
    };
  }

  const session = await createSession(deps.db, fresh.id, { ip: ctx.ip });
  await touchLogin(deps.db, fresh.id);
  return { status: 200, body: { user: clientUser(fresh, { withActive: true }) }, session };
}

export async function resendVerification(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  input: { email: string },
): Promise<AuthOutcome> {
  const user = await getByEmail(deps.db, input.email);
  if (user && user.active && !user.email_verified) {
    try {
      await sendVerificationEmail(deps, user);
      await audit(deps, ctx, {
        action: AUDIT_ACTION.AUTH_VERIFICATION_RESENT,
        actorEmail: user.email,
        targetId: user.id,
      });
    } catch (error) {
      deps.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'verification resend failed',
      );
    }
  }
  return { status: 200, body: { ok: true, message: '如果邮箱存在，验证邮件将很快送达' } };
}

/* -------------------------------- password -------------------------------- */

export async function forgotPassword(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  input: { email: string },
): Promise<AuthOutcome> {
  const user = await getByEmail(deps.db, input.email);
  if (user && user.active) {
    try {
      await sendPasswordResetEmail(deps, user);
      await audit(deps, ctx, {
        action: AUDIT_ACTION.AUTH_PASSWORD_RESET_REQUESTED,
        actorEmail: user.email,
        targetId: user.id,
      });
    } catch (error) {
      deps.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'password reset mail failed',
      );
    }
  }
  return { status: 200, body: { ok: true, message: '如果邮箱存在，重置邮件将很快送达' } };
}

export async function resetPassword(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  input: { token: string; password: string },
): Promise<AuthOutcome> {
  const tokenRow = await findAuthToken(deps.db, input.token, 'reset');
  if (!tokenRow) throw badRequest('重置链接无效或已过期');

  const user = await getById(deps.db, tokenRow.user_id);
  if (!user || !user.active) throw badRequest('账号不可用');

  const redeemed = await consumeAuthToken(deps.db, input.token, 'reset');
  if (!redeemed) throw badRequest('重置链接无效或已过期');

  await updatePasswordHash(deps.db, user.id, await hashPassword(input.password));
  await markEmailVerified(deps.db, user.id);
  await destroyUserSessions(deps.db, user.id);
  await resetLoginFailures(deps.db, user.id);

  await audit(deps, ctx, {
    action: AUDIT_ACTION.AUTH_PASSWORD_RESET,
    actorEmail: user.email,
    targetId: user.id,
  });
  return { status: 200, body: { ok: true } };
}

export async function changePassword(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  actor: AuthUser,
  sessionToken: string | undefined,
  input: { currentPassword: string; newPassword: string },
): Promise<AuthOutcome> {
  const user = await getById(deps.db, actor.id);
  const verified = await verifyPassword(input.currentPassword, user?.password_hash);
  if (!user || !verified.valid) throw badRequest('当前密码不正确');

  await updatePasswordHash(deps.db, user.id, await hashPassword(input.newPassword));
  await destroyUserSessions(deps.db, user.id, { exceptToken: sessionToken ?? null });

  await audit(deps, ctx, {
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTION.AUTH_PASSWORD_CHANGED,
    targetId: user.id,
  });
  return { status: 200, body: { ok: true } };
}

/* ---------------------------------- MFA ----------------------------------- */

export async function setupMfa(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  actor: AuthUser,
): Promise<AuthOutcome> {
  const user = await getById(deps.db, actor.id);
  if (!user) throw unauthorized('请先登录');
  if (user.mfa_enabled) throw conflict('MFA 已启用');

  const secret = generateTotpSecret();
  await setPendingMfaSecret(deps.db, user.id, createMfaCipher(deps.env, deps.logger).encrypt(secret));
  await audit(deps, ctx, {
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTION.AUTH_MFA_SETUP_STARTED,
    targetId: user.id,
  });
  return {
    status: 200,
    body: {
      secret,
      otpauthUri: otpauthUri(user.email, secret),
      message: '在认证器中添加该密钥，然后输入 6 位验证码完成启用',
    },
  };
}

export async function enableMfaForUser(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  actor: AuthUser,
  sessionToken: string | undefined,
  input: { code: string },
): Promise<AuthOutcome> {
  const user = await getById(deps.db, actor.id);
  if (!user?.mfa_secret) throw badRequest('请先获取 MFA 密钥');

  let secret: string;
  try {
    secret = createMfaCipher(deps.env, deps.logger).decrypt(user.mfa_secret);
  } catch {
    throw badRequest('请先获取 MFA 密钥');
  }
  if (!verifyTotp(secret, input.code)) throw badRequest('验证码不正确');

  const codes = generateRecoveryCodes(8);
  await enableMfa(deps.db, user.id, codes.map(hashRecoveryCode));
  // Password-only sessions created before MFA was enabled must re-authenticate.
  await destroyUserSessions(deps.db, user.id, { exceptToken: sessionToken ?? null });

  await audit(deps, ctx, {
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTION.AUTH_MFA_ENABLED,
    targetId: user.id,
  });
  return { status: 200, body: { recoveryCodes: codes } };
}

export async function disableMfaForUser(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  actor: AuthUser,
  input: { password: string },
): Promise<AuthOutcome> {
  const user = await getById(deps.db, actor.id);
  if (!user?.mfa_enabled) throw badRequest('MFA 未启用');

  const verified = await verifyPassword(input.password, user.password_hash);
  if (!verified.valid) throw badRequest('密码不正确');

  await disableMfa(deps.db, user.id);
  await audit(deps, ctx, {
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTION.AUTH_MFA_DISABLED,
    targetId: user.id,
  });
  return { status: 200, body: { ok: true } };
}

/* --------------------------------- logout -------------------------------- */

export async function logout(
  deps: AuthServiceDeps,
  ctx: AuthContext,
  actor: AuthUser | null | undefined,
  sessionToken: string | undefined,
): Promise<AuthOutcome> {
  if (actor) {
    await audit(deps, ctx, {
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTION.AUTH_LOGOUT,
      targetId: actor.id,
    });
  }
  if (sessionToken) await destroySession(deps.db, sessionToken);
  return { status: 200, body: { ok: true } };
}