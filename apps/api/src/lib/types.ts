/**
 * Shared API types: dependency injection bag, authenticated user shape, mail
 * abstraction and Express request augmentation.
 *
 * Importing this module (or merely compiling it, as it is part of the project)
 * applies the global `Express.Request` augmentation used across middleware and
 * route modules.
 */
import type { Request } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { Db } from '@portal/db';
import type { Env } from '@portal/config';
import type { UserRole } from '@portal/contracts';
import type { RateLimiter, RedisLike } from './rate-limit.js';

export type { RedisLike };

/**
 * Dependencies injected into `createApp`. `pool` is optional: supertest and
 * integration tests may hand in only a Drizzle `db`, while `index.ts` passes
 * the real pool for graceful shutdown.
 */
export type AppDeps = {
  db: Db;
  pool?: Pool;
  redis: RedisLike;
  mailer: Mailer;
  env: Env;
  logger: Logger;
};

/** Safe, session-scoped user shape (camelCase, no password hash). */
export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: boolean;
  mfaEnabled: boolean;
};

/** Message handed to a mail transport. */
export type MailMessage = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
};

export type MailResult = { mode: string };

export type Mailer = {
  send(message: MailMessage): Promise<MailResult>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Authenticated user resolved from the session cookie, or null. */
      user?: AuthUser | null;
      /** Raw session token from the `aip_session` cookie (never logged). */
      sessionToken?: string;
      /** Correlation id echoed in `X-Request-Id` and every log line. */
      requestId: string;
      /** Zod-parsed query object, set by `validateQuery`. */
      validatedQuery?: unknown;
      /** Zod-parsed route params, set by `validateParams`. */
      validatedParams?: unknown;
    }

    interface Locals {
      /** Dependency bag installed by `createApp` (route agents: `req.app.locals.deps`). */
      deps?: AppDeps;
      db?: Db;
      env?: Env;
      mailer?: Mailer;
      rateLimiter?: RateLimiter;
    }
  }
}

/**
 * Read the dependency bag installed by `createApp`. Route agents use this
 * instead of threading `db`/`mailer`/`logger` through every handler.
 */
export function appDeps(req: Request): AppDeps {
  const deps = req.app?.locals?.deps as AppDeps | undefined;
  if (!deps) throw new Error('createApp dependencies are not installed on app.locals');
  return deps;
}

export {};