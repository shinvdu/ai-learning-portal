/**
 * Session resolution middleware: attach `req.user` and `req.sessionToken` from
 * the `aip_session` cookie. Non-API requests skip the database lookup.
 */
import type { RequestHandler } from 'express';
import type { Db } from '@portal/db';
import { SESSION_COOKIE_NAME } from '@portal/config';
import { parseCookies } from '../lib/cookies.js';
import { getSessionUser } from '../db/repositories/sessions.js';

export function sessionMiddleware(db: Db): RequestHandler {
  return async (req, _res, next) => {
    if (!req.path.startsWith('/api')) {
      next();
      return;
    }
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] ?? '';
      if (!token) {
        req.sessionToken = undefined;
        req.user = null;
        next();
        return;
      }
      req.sessionToken = token;
      req.user = await getSessionUser(db, token);
      next();
    } catch (error) {
      next(error);
    }
  };
}