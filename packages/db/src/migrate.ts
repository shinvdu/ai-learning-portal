/**
 * Migration runner with a Postgres advisory lock.
 *
 * Multiple API instances / deploy jobs may start at the same time; the lock
 * serialises them so the Drizzle journal is applied exactly once. The lock is
 * session-scoped and released in `finally`, and also drops if the connection
 * dies, so a crashed runner cannot wedge future deploys.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as clientModule from './client.js';
import * as schema from './schema.js';

/** Default: `packages/db/drizzle` (works from both `src/` and `dist/`). */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

const ADVISORY_LOCK_KEY = 'portal_migrations';

export type RunMigrationsOptions = {
  /** Defaults to `DATABASE_URL`. */
  connectionString?: string;
  /** Defaults to `MIGRATIONS_DIR` or the packaged `drizzle/` folder. */
  migrationsFolder?: string;
};

export type RunMigrationsResult = {
  migrationsFolder: string;
  acquiredLock: boolean;
};

/**
 * Acquire `pg_advisory_lock(hashtext('portal_migrations'))`, apply pending
 * Drizzle migrations, then unlock. Re-running is a no-op once the journal is
 * current.
 */
export async function runMigrations(
  options: RunMigrationsOptions = {},
): Promise<RunMigrationsResult> {
  const migrationsFolder =
    options.migrationsFolder ?? process.env.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR;
  const pool = clientModule.createPool({ connectionString: options.connectionString });
  let client: PoolClient | undefined;
  let acquiredLock = false;

  try {
    client = await pool.connect();
    // Single blocking acquire; reaching this line means the lock is held.
    await client.query('select pg_advisory_lock(hashtext($1))', [ADVISORY_LOCK_KEY]);
    acquiredLock = true;

    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    return { migrationsFolder, acquiredLock };
  } finally {
    if (client) {
      if (acquiredLock) {
        try {
          await client.query('select pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK_KEY]);
        } catch (error) {
          console.error(
            '[db] failed to release migration advisory lock:',
            error instanceof Error ? error.message : error,
          );
        }
      }
      client.release();
    }
    await pool.end();
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[db] MIGRATION_DATABASE_URL or DATABASE_URL must be set');
    process.exitCode = 1;
  } else {
    runMigrations({ connectionString })
      .then(({ migrationsFolder }) => {
        console.log(`[db] migrations applied from ${migrationsFolder}`);
      })
      .catch((error: unknown) => {
        console.error('[db] migration failed:', error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}