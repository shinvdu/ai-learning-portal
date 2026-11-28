/**
 * Fixed-window rate limiting backed by Redis (F046 / ADR-005).
 *
 * The Lua script performs `INCR` and sets the TTL with `PEXPIRE ... NX` in one
 * atomic round trip, so multiple API instances share a single counter. Keys are
 * `rl:<scope>:<ip|userId>`. Successful register/login/MFA handlers call
 * `clear` to empty the bucket, matching v1's "clear on success" semantics.
 *
 * If Redis is unreachable or slower than `commandTimeoutMs`, the limiter logs a
 * warning once, switches to an in-process `Map` window (same semantics, per
 * instance) and reports `degraded` so `/readyz` can surface the problem.
 */
import type { Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { RATE_LIMIT_ACCOUNT, RATE_LIMIT_PUBLIC_AUTH } from '@portal/config';
import { clientIp } from './ip.js';

/** Minimal Redis surface used here; satisfied by `ioredis`. */
export type RedisLike = {
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
  ping(): Promise<string>;
  del(...keys: string[]): Promise<number>;
};

export type RateLimitResult = {
  limited: boolean;
  count: number;
  remaining: number;
  /** Epoch milliseconds at which the current fixed window resets. */
  resetAtMs: number;
  degraded: boolean;
};

export type RateLimiterHealth = { ok: boolean; degraded: boolean };

export interface RateLimiter {
  consume(key: string, max: number, windowMs: number): Promise<RateLimitResult>;
  clear(key: string): Promise<void>;
  health(): Promise<RateLimiterHealth>;
  readonly degraded: boolean;
}

export type RateLimiterOptions = { commandTimeoutMs?: number };

const INCR_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[1], 'NX')
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

const DEFAULT_COMMAND_TIMEOUT_MS = 500;
const MEMORY_SWEEP_THRESHOLD = 2000;

type MemoryBucket = { count: number; resetAtMs: number };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('redis command timed out')), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Canonical bucket key: `rl:<scope>:<identifier>`. */
export function rateLimitKey(scope: string, identifier: string | number): string {
  return `rl:${scope}:${identifier}`;
}

/**
 * Create a rate limiter. Passing `undefined` as `redis` yields a pure
 * in-memory limiter (useful in unit tests and as the degraded fallback).
 */
export function createRateLimiter(
  redis?: RedisLike | null,
  logger?: Logger,
  options: RateLimiterOptions = {},
): RateLimiter {
  const memory = new Map<string, MemoryBucket>();
  const timeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  let degraded = redis ? false : true;
  let reportedFailure = false;

  const sweepMemory = (now: number): void => {
    if (memory.size <= MEMORY_SWEEP_THRESHOLD) return;
    for (const [key, bucket] of memory) {
      if (bucket.resetAtMs <= now) memory.delete(key);
    }
  };

  const consumeMemory = (key: string, max: number, windowMs: number): RateLimitResult => {
    const now = Date.now();
    let bucket = memory.get(key);
    if (!bucket || bucket.resetAtMs <= now) {
      bucket = { count: 0, resetAtMs: now + windowMs };
      memory.set(key, bucket);
    }
    bucket.count += 1;
    sweepMemory(now);
    return {
      limited: bucket.count > max,
      count: bucket.count,
      remaining: Math.max(0, max - bucket.count),
      resetAtMs: bucket.resetAtMs,
      degraded: true,
    };
  };

  const markFailure = (error: unknown): void => {
    degraded = true;
    if (!reportedFailure) {
      reportedFailure = true;
      logger?.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'rate limiter degraded: Redis unavailable, using in-memory fallback',
      );
    }
  };

  return {
    get degraded() {
      return degraded;
    },

    async consume(key, max, windowMs) {
      if (!redis) return consumeMemory(key, max, windowMs);
      try {
        const raw = await withTimeout(redis.eval(INCR_WINDOW_SCRIPT, 1, key, windowMs), timeoutMs);
        if (!Array.isArray(raw) || raw.length < 2) throw new Error('unexpected Redis reply');
        const count = Number(raw[0]);
        const ttl = Number(raw[1]);
        if (!Number.isFinite(count)) throw new Error('unexpected Redis counter');
        if (degraded || reportedFailure) {
          degraded = false;
          reportedFailure = false;
          logger?.info('rate limiter recovered: Redis available again');
        }
        const resetAtMs = Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : windowMs);
        return {
          limited: count > max,
          count,
          remaining: Math.max(0, max - count),
          resetAtMs,
          degraded: false,
        };
      } catch (error) {
        markFailure(error);
        return consumeMemory(key, max, windowMs);
      }
    },

    async clear(key) {
      memory.delete(key);
      if (!redis) return;
      try {
        await withTimeout(redis.del(key), timeoutMs);
      } catch (error) {
        markFailure(error);
      }
    },

    async health() {
      if (!redis) {
        degraded = true;
        return { ok: false, degraded: true };
      }
      try {
        const pong = await withTimeout(redis.ping(), timeoutMs);
        const ok = String(pong).toUpperCase() === 'PONG';
        degraded = !ok;
        if (ok) reportedFailure = false;
        return { ok, degraded: !ok };
      } catch (error) {
        markFailure(error);
        return { ok: false, degraded: true };
      }
    },
  };
}

/* ----------------------------- route helpers ----------------------------- */

export type RateLimitBy = 'ip' | 'user';

export type RateLimitRouteOptions = {
  max: number;
  windowMs: number;
  by?: RateLimitBy;
  message?: string;
};

const fallbackLimiter = createRateLimiter(undefined);

function limiterFor(req: Request): RateLimiter {
  const locals = req.app?.locals as Record<string, unknown> | undefined;
  const candidate = locals?.rateLimiter;
  return isRateLimiter(candidate) ? candidate : fallbackLimiter;
}

function isRateLimiter(value: unknown): value is RateLimiter {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RateLimiter).consume === 'function' &&
    typeof (value as RateLimiter).clear === 'function'
  );
}

function bucketIdentifier(req: Request, by: RateLimitBy): string {
  if (by === 'user' && req.user) return String(req.user.id);
  return clientIp(req) ?? 'unknown';
}

/**
 * Route-level limiter. Apply to individual auth/admin handlers, e.g.
 * `router.post('/login', rateLimit('login', RATE_LIMIT_PUBLIC_AUTH), handler)`.
 * On success call `clearRateLimit(req, 'login')` (or `clearRateLimitResponse`).
 */
export function rateLimit(scope: string, options: RateLimitRouteOptions): RequestHandler {
  return async (req, res, next) => {
    const limiter = limiterFor(req);
    const by = options.by ?? 'ip';
    const key = rateLimitKey(scope, bucketIdentifier(req, by));
    res.locals.rateLimitKey = key;
    res.locals.rateLimiter = limiter;

    const result = await limiter.consume(key, options.max, options.windowMs);
    if (result.limited) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAtMs - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: options.message ?? '尝试次数过多，请稍后再试' });
      return;
    }
    next();
  };
}

/** Public auth preset: 20 requests / 10 minutes per IP. */
export function rateLimitPublicAuth(scope: string): RequestHandler {
  return rateLimit(scope, { ...RATE_LIMIT_PUBLIC_AUTH, by: 'ip' });
}

/** Account preset: 10 requests / 10 minutes per authenticated user. */
export function rateLimitAccount(scope: string): RequestHandler {
  return rateLimit(scope, { ...RATE_LIMIT_ACCOUNT, by: 'user' });
}

/** Recompute and clear a bucket (call after a successful auth action). */
export async function clearRateLimit(
  req: Request,
  scope: string,
  by: RateLimitBy = 'ip',
): Promise<void> {
  await limiterFor(req).clear(rateLimitKey(scope, bucketIdentifier(req, by)));
}

/** Clear the bucket recorded by the most recent `rateLimit` middleware. */
export async function clearRateLimitResponse(res: Response): Promise<void> {
  const key = res.locals.rateLimitKey as string | undefined;
  const limiter = res.locals.rateLimiter as RateLimiter | undefined;
  if (!key) return;
  await (isRateLimiter(limiter) ? limiter : fallbackLimiter).clear(key);
}