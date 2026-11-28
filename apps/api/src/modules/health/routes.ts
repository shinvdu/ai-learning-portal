/**
 * Health endpoints (F034).
 *
 * - `GET /healthz` — process liveness only: `{ok:true, uptime}`.
 * - `GET /readyz`  — PostgreSQL `select 1`, Redis `PING` and Drizzle migration
 *   journal currency; any failure returns 503 `{ok:false}`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { DEFAULT_MIGRATIONS_DIR } from '@portal/db';
import type { AppDeps } from '../../lib/types.js';

const REDIS_TIMEOUT_MS = 1500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
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

function journalEntryCount(): number {
  try {
    const raw = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8');
    const parsed = JSON.parse(raw) as { entries?: unknown };
    return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
  } catch {
    return 0;
  }
}

async function checkDatabase(deps: Pick<AppDeps, 'db'>): Promise<boolean> {
  try {
    await deps.db.execute(sql`select 1 as ok`);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(deps: Pick<AppDeps, 'redis'>): Promise<boolean> {
  try {
    const pong = await withTimeout(deps.redis.ping(), REDIS_TIMEOUT_MS);
    return String(pong).toUpperCase() === 'PONG';
  } catch {
    return false;
  }
}

async function checkMigrations(deps: Pick<AppDeps, 'db'>): Promise<boolean> {
  const expected = journalEntryCount();
  if (expected === 0) return false;
  try {
    const result = await deps.db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    const applied = Number(result.rows[0]?.count ?? 0);
    return applied >= expected;
  } catch {
    return false;
  }
}

export function createHealthRouter(deps: Pick<AppDeps, 'db' | 'redis' | 'logger'>): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  router.get('/readyz', async (_req, res) => {
    const [database, redis, migrations] = await Promise.all([
      checkDatabase(deps),
      checkRedis(deps),
      checkMigrations(deps),
    ]);
    const ok = database && redis && migrations;
    if (!ok) deps.logger.warn({ database, redis, migrations }, 'readiness check failed');
    res.status(ok ? 200 : 503).json({ ok });
  });

  return router;
}