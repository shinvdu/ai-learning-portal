/**
 * Pool / Drizzle factory helpers.
 *
 * `pg` is loaded as a default import because it is a CommonJS package; the
 * named exports (`Pool`, `types`) are read off the default export.
 */
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool, types } = pg;

/**
 * Keep `date` (OID 1082) as the exact `YYYY-MM-DD` string Postgres sends.
 * The default parser turns it into a JS Date at local midnight, which drifts
 * across time zones (ADR-003 / architecture 2.5 item 5).
 */
types.setTypeParser(1082, (value: string) => value);

export type Db = NodePgDatabase<typeof schema>;

export type CreatePoolOptions = {
  connectionString?: string;
  /** Receives idle-client errors; defaults to a console warning. */
  onError?: (error: Error) => void;
};

/** Resolve the database URL, preferring `DATABASE_URL`. */
export function resolveDatabaseUrl(explicit?: string): string {
  const url = explicit ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to create a PostgreSQL pool');
  }
  return url;
}

/**
 * Create a `pg.Pool` with a non-throwing idle error handler. An idle client
 * error (e.g. the server restarted) must not crash the process; the pool will
 * discard the client and reconnect on demand.
 */
export function createPool(options: CreatePoolOptions | string = {}): pg.Pool {
  const normalized: CreatePoolOptions =
    typeof options === 'string' ? { connectionString: options } : options;
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(normalized.connectionString),
  });
  const onError =
    normalized.onError ??
    ((error: Error) => {
      console.error('[db] idle client error:', error.message);
    });
  pool.on('error', onError);
  return pool;
}

/** Wrap an existing pool (or create one) in a Drizzle instance. */
export function createDb(pool?: pg.Pool): Db;
export function createDb(connectionString: string): Db;
export function createDb(poolOrUrl?: pg.Pool | string): Db {
  const pool = typeof poolOrUrl === 'string' ? createPool(poolOrUrl) : (poolOrUrl ?? createPool());
  return drizzle(pool, { schema });
}