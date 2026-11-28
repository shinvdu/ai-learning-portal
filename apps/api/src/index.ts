/**
 * API entry point (F030/F034).
 *
 * Loads and validates configuration, wires PostgreSQL (`pg` pool + Drizzle),
 * Redis (ioredis), the mailer and the Express app, runs the admin bootstrap and
 * purges expired sessions, then listens. SIGTERM/SIGINT stop accepting
 * connections, drain within 10s, close the pool/Redis and exit 0.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Redis } from 'ioredis';
import { createDb, createPool } from '@portal/db';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';
import { createMailer } from './modules/auth/mail.js';
import { bootstrapAdmin } from './modules/auth/admin-bootstrap.js';
import { purgeExpiredSessions } from './db/repositories/sessions.js';
import type { AppDeps } from './lib/types.js';

export { createApp } from './app.js';
export { loadConfig } from './config.js';
export const APP_NAME = 'ai-learning-portal-api';

const GRACEFUL_TIMEOUT_MS = 10_000;

export async function start(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const pool = createPool({
    connectionString: config.DATABASE_URL,
    onError: (error) => logger.warn({ err: error.message }, 'postgres idle client error'),
  });
  const db = createDb(pool);

  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  });
  redis.on('error', (error: Error) => logger.warn({ err: error.message }, 'redis connection error'));

  const mailer = createMailer(config, logger);
  const deps: AppDeps = { db, pool, redis, mailer, env: config, logger };
  const app = createApp(deps);

  try {
    const admin = await bootstrapAdmin({ db, env: config, logger });
    if (admin.created) logger.info({ email: config.ADMIN_EMAIL }, 'admin account created');
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'admin bootstrap failed',
    );
  }

  try {
    const purged = await purgeExpiredSessions(db);
    if (purged > 0) logger.info({ purged }, 'purged expired sessions');
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'failed to purge expired sessions',
    );
  }

  const server = app.listen(config.PORT, config.HOST, () => {
    const shownHost = config.HOST === '0.0.0.0' ? 'localhost' : config.HOST;
    logger.info(
      { host: config.HOST, port: config.PORT, env: config.APP_ENV, url: `http://${shownHost}:${config.PORT}` },
      'API listening',
    );
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');

    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, GRACEFUL_TIMEOUT_MS);
    force.unref();

    server.close((closeError?: Error) => {
      clearTimeout(force);
      if (closeError) logger.warn({ err: closeError.message }, 'server close error');
      void (async () => {
        try {
          await pool.end();
        } catch (error) {
          logger.warn(
            { err: error instanceof Error ? error.message : String(error) },
            'failed to close postgres pool',
          );
        }
        try {
          await redis.quit();
        } catch {
          try {
            redis.disconnect();
          } catch {
            /* already closed */
          }
        }
        process.exit(0);
      })();
    });
    server.closeIdleConnections?.();
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  server.on('error', (error: Error) => {
    logger.error({ err: error.message }, 'server error');
    void shutdown('server-error');
  });
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  start().catch((error: unknown) => {
    console.error('[api] 启动失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}