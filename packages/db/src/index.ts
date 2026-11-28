import { sql } from 'drizzle-orm';

export const DB_PACKAGE = '@portal/db';

export const DATABASE_DRIVER = 'postgres';

export const DB_PLACEHOLDER_PING = sql`select 1`;

export const FIXTURES_DIR = 'fixtures';

export * from './schema.js';
export {
  createDb,
  createPool,
  resolveDatabaseUrl,
  type CreatePoolOptions,
  type Db,
} from './client.js';
export {
  DEFAULT_MIGRATIONS_DIR,
  runMigrations,
  type RunMigrationsOptions,
  type RunMigrationsResult,
} from './migrate.js';