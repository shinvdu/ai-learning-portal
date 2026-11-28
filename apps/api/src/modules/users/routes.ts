/**
 * `/api/v1/admin/users` (F060).
 *
 * Thin HTTP layer over the users repository implemented by the auth agent:
 * - `GET`  lists safe fields only (no password hash / MFA secret),
 * - `POST` creates an active, email-verified user by default and rejects
 *   duplicate emails case-insensitively,
 * - `PATCH` supports name/role/active/password/unlock/emailVerified/resetMfa.
 *
 * Repository guards are inherited unchanged: the last active admin cannot be
 * demoted/disabled, an admin cannot demote/disable themselves, deactivation
 * revokes every session, and a password change revokes the target's sessions
 * while keeping the actor's current session on self-service changes.
 */
import { Router } from 'express';
import { AUDIT_ACTION } from '@portal/contracts';
import { appDeps } from '../../lib/types.js';
import { notFound } from '../../lib/errors.js';
import { auditRequest } from '../audit/service.js';
import {
  createUser,
  listUsers,
  updateUser,
  type UpdateUserPatch,
} from '../../db/repositories/users.js';

export const adminUsersRouter = Router();

type Body = Record<string, unknown>;

function bodyOf(value: unknown): Body {
  return typeof value === 'object' && value !== null ? (value as Body) : {};
}

adminUsersRouter.get('/', async (req, res) => {
  const { db } = appDeps(req);
  res.json({ users: await listUsers(db) });
});

adminUsersRouter.post('/', async (req, res) => {
  const { db } = appDeps(req);
  const body = bodyOf(req.body);

  const result = await createUser(db, {
    name: String(body.name ?? ''),
    email: String(body.email ?? ''),
    password: String(body.password ?? ''),
    role: body.role === 'admin' ? 'admin' : 'learner',
    active: body.active !== false,
  });

  if (!result.ok) {
    res.status(400).json({ error: result.errors[0], errors: result.errors });
    return;
  }

  await auditRequest(req, db, AUDIT_ACTION.ADMIN_USER_CREATED, {
    targetType: 'user',
    targetId: result.user.id,
    details: { email: result.user.email, role: result.user.role },
  });
  res.status(201).json(result);
});

adminUsersRouter.patch('/:id', async (req, res) => {
  const { db } = appDeps(req);
  const targetId = Number(req.params.id);
  if (!/^\d+$/.test(String(req.params.id ?? '')) || !Number.isInteger(targetId) || targetId <= 0) {
    // v1 only routed numeric ids; anything else is the generic API 404.
    throw notFound('接口不存在');
  }
  const body = bodyOf(req.body);

  const patch: UpdateUserPatch = {};
  if (body.name !== undefined) patch.name = String(body.name ?? '');
  if (body.role !== undefined) patch.role = body.role as 'admin' | 'learner';
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.password !== undefined) patch.password = String(body.password ?? '');
  if (body.unlock !== undefined) patch.unlock = Boolean(body.unlock);
  if (body.emailVerified !== undefined) patch.emailVerified = Boolean(body.emailVerified);
  if (body.resetMfa !== undefined) patch.resetMfa = Boolean(body.resetMfa);

  const actingUserId = req.user?.id ?? null;
  const result = await updateUser(db, targetId, patch, {
    actingUserId,
    // Keep the actor's current session when they reset their own password.
    exceptToken: actingUserId === targetId ? (req.sessionToken ?? null) : null,
  });

  if (!result.ok) {
    const status = result.notFound ? 404 : 400;
    res.status(status).json(result);
    return;
  }

  const changedFields = Object.keys(body).filter((key) => key !== 'password');
  await auditRequest(req, db, AUDIT_ACTION.ADMIN_USER_UPDATED, {
    targetType: 'user',
    targetId,
    details: {
      fields: changedFields,
      passwordReset: body.password !== undefined,
      unlock: body.unlock === true,
      resetMfa: body.resetMfa === true,
    },
  });
  res.json(result);
});