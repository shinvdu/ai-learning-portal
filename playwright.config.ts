import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/env';

/**
 * Playwright configuration for the v2 portal smoke suite.
 *
 * Two `webServer` entries are started (or reused locally):
 *   1. the built API on `E2E.apiPort` (default 8787) against PostgreSQL and
 *      Redis DB 15, bootstrapping a known admin account;
 *   2. the Vite dev server on 5173, proxying `/api` to the API.
 *
 * Prerequisites: the target database must be migrated and seeded *before*
 * running the suite. CI does this explicitly; locally use a throwaway DB:
 *
 *   DATABASE_URL=postgres://portal:portal@127.0.0.1:5433/ai_portal_e2e \
 *     npm run db:migrate
 *   DATABASE_URL=postgres://portal:portal@127.0.0.1:5433/ai_portal_e2e \
 *     npm run seed -w @portal/api -- --demo-records
 *
 * `npm run build` must have produced `apps/api/dist` first.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: E2E.webUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // CI installs the bundled browser. Locally, `PLAYWRIGHT_CHANNEL=chrome`
        // reuses an already-installed Google Chrome instead of downloading one.
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
      },
    },
  ],

  webServer: [
    {
      name: 'api',
      command: 'node apps/api/dist/index.js',
      url: `${E2E.apiUrl}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        APP_ENV: 'test',
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(E2E.apiPort),
        DATABASE_URL: E2E.databaseUrl,
        REDIS_URL: E2E.redisUrl,
        PUBLIC_BASE_URL: E2E.apiUrl,
        MFA_ENC_KEY: E2E.mfaEncKey,
        MAIL_TRANSPORT: 'console',
        ADMIN_EMAIL: E2E.adminEmail,
        ADMIN_PASSWORD: E2E.adminPassword,
        LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
        SERVE_WEB: '0',
        TRUST_PROXY: '0',
        // The database is prepared by the CI/local setup steps, never by the API.
        SEED_DEMO_RECORDS: '0',
        ALLOW_DEMO_RESET: '0',
      },
    },
    {
      name: 'web',
      command: 'npm run dev -w @portal/web -- --host 127.0.0.1 --port 5173 --strictPort',
      url: E2E.webUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_TARGET: E2E.apiUrl,
      },
    },
  ],
});