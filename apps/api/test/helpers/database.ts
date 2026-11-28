/**
 * Test database lifecycle helpers.
 *
 * Only ever touches `ai_portal_test`. The suite creates it if missing, applies
 * the packaged Drizzle migrations, then resets the seeded domain data so the
 * golden fixture is exact before any assertion runs.
 */
import { Client } from 'pg';
import { notInArray, sql } from 'drizzle-orm';
import {
  createDb,
  createPool,
  runMigrations,
  type Db,
} from '@portal/db';
import { chapters, courses, knowledge, records } from '@portal/db';
import { resetSeedData, runSeed } from '../../src/seed/seed.js';
import { bootstrapAdmin } from '../../src/modules/auth/admin-bootstrap.js';
import type { AppConfig } from '../../src/config.js';
import type { Logger } from 'pino';

export const SEED_COURSE_IDS = ['C1', 'C2', 'C3', 'C4', 'C5'] as const;

function maintenanceUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

/** Create the test database when it does not exist yet. */
export async function ensureDatabase(connectionString: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl(connectionString) });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [
      databaseName,
    ]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await client.end();
  }
}

/** Apply migrations (idempotent under the advisory lock). */
export async function migrateTestDatabase(connectionString: string): Promise<void> {
  await runMigrations({ connectionString });
}

/**
 * Remove every user/audit row, restore the seed domain data and restart the
 * course sequence so the next created course is always `C6`.
 */
export async function prepareSeededDatabase(db: Db): Promise<void> {
  await resetSeedData(db);
  await db.execute(sql`delete from app_meta`);
  await db.execute(sql`delete from audit_log`);
  await db.execute(sql`delete from users`);
  await db.execute(sql`alter sequence course_seq restart with 1`);
  await runSeed(db, {
    demoRecords: true,
    reset: false,
    force: false,
    production: false,
  });
}

/** Create the bootstrap admin with the known test password. */
export async function ensureAdmin(
  db: Db,
  env: AppConfig,
  logger: Logger,
): Promise<void> {
  await bootstrapAdmin({ db, env, logger });
}

/** Delete course rows created by a test (records first: FK is RESTRICT). */
export async function deleteExtraCourses(db: Db): Promise<void> {
  await db.delete(records).where(notInArray(records.course_id, [...SEED_COURSE_IDS]));
  await db.delete(chapters).where(notInArray(chapters.course_id, [...SEED_COURSE_IDS]));
  await db.delete(knowledge).where(notInArray(knowledge.course_id, [...SEED_COURSE_IDS]));
  await db.delete(courses).where(notInArray(courses.id, [...SEED_COURSE_IDS]));
}

/** Convenience runtime bundle used by the integration file. */
export function openDatabase(connectionString: string): { db: Db; pool: ReturnType<typeof createPool> } {
  const pool = createPool({ connectionString });
  return { pool, db: createDb(pool) };
}