/**
 * Shared Playwright configuration values.
 *
 * Both `playwright.config.ts` (which starts the API + Vite) and the specs
 * (which need the admin credentials) import from here so there is a single
 * source of truth.
 *
 * The defaults point at the local workshop services from `compose.yml`
 * (PostgreSQL on 5433, Redis on 6380) and a *seeded* `ai_portal` database.
 * Override any value via the environment for a different setup:
 *
 *   PLAYWRIGHT_API_PORT     API port (default 8787; the v1 `server.js` also
 *                           uses 8787, so pick another port when it is running)
 *   DATABASE_URL            e.g. a throwaway `ai_portal_e2e` database
 *   REDIS_URL               defaults to Redis DB 15
 *   ADMIN_EMAIL / ADMIN_PASSWORD  bootstrap admin the API creates on start
 *
 * `MFA_ENC_KEY` below is a throwaway 32-byte test key, not a secret.
 */

const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 8787);

export const E2E = {
  apiPort,
  apiUrl: `http://127.0.0.1:${apiPort}`,
  webUrl: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://portal:portal@127.0.0.1:5433/ai_portal',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6380/15',
  mfaEncKey:
    process.env.MFA_ENC_KEY ?? 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@ci.test',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'ci-admin-password',
} as const;