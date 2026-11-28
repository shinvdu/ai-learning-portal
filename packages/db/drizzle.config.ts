import { defineConfig } from 'drizzle-kit';

/**
 * `db:generate` writes schema diffs into `drizzle/`. The v2 baseline is the
 * hand-reviewed `0001_initial.sql`; future schema changes should be generated
 * on top of it and reviewed as plain SQL.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://portal:portal@127.0.0.1:5433/ai_portal',
  },
});