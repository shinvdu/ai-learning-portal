/**
 * Reject cross-origin mutating API requests (F045). Requests without an
 * `Origin` header are allowed through, matching v1 and CI/curl usage.
 */
import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { isMutatingMethod } from '../lib/csrf.js';
import { isSameOrigin } from '../lib/origin.js';

export const originGuard: RequestHandler = (req, _res, next) => {
  if (!req.path.startsWith('/api') || !isMutatingMethod(req.method)) {
    next();
    return;
  }
  if (!isSameOrigin(req)) {
    next(new AppError(403, '跨站请求被拒绝'));
    return;
  }
  next();
};