/**
 * Double-submit CSRF guard for mutating API requests (F045). Safe methods and
 * requests without `Origin` pass; browser requests must echo the `aip_csrf`
 * cookie in `X-CSRF-Token`.
 */
import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { csrfValid } from '../lib/csrf.js';

export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (!req.path.startsWith('/api')) {
    next();
    return;
  }
  if (!csrfValid(req)) {
    next(new AppError(403, 'CSRF 校验失败，请刷新页面后重试'));
    return;
  }
  next();
};