/**
 * Admin gate with the exact v1 messages: 401 `请先登录` when anonymous,
 * 403 `需要管理员权限` for learners.
 */
import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(unauthorized('请先登录'));
    return;
  }
  if (req.user.role !== 'admin') {
    next(forbidden('需要管理员权限'));
    return;
  }
  next();
};