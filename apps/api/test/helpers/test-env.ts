/**
 * Test environment bootstrap.
 *
 * Sets the process environment once (before any app module reads it) and
 * exposes two validated configs:
 *  - `TEST_ENV`  — APP_ENV=test, console mail, local test database/Redis DB 15.
 *  - `PROD_ENV`  — production-style flags used to exercise the verification
 *                  flow without turning the whole suite into production mode.
 *
 * The database is always `ai_portal_test`; the main `ai_portal` database is
 * never referenced here.
 */
import { Buffer } from 'node:buffer';
import { loadConfig, type AppConfig } from '../../src/config.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://portal:portal@127.0.0.1:5433/ai_portal_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380/15';
export const TEST_PUBLIC_BASE_URL = 'http://127.0.0.1:8787';
export const TEST_ADMIN_EMAIL = 'admin@portal.test';
export const TEST_ADMIN_PASSWORD = 'TestAdminPass123';
export const TEST_MFA_KEY = Buffer.alloc(32, 7).toString('base64');
export const TEST_DATABASE_NAME = 'ai_portal_test';

Object.assign(process.env, {
  APP_ENV: 'test',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  PUBLIC_BASE_URL: TEST_PUBLIC_BASE_URL,
  MFA_ENC_KEY: TEST_MFA_KEY,
  MAIL_TRANSPORT: 'console',
  ADMIN_EMAIL: TEST_ADMIN_EMAIL,
  ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
  LOG_LEVEL: 'silent',
  SERVE_WEB: '0',
  TRUST_PROXY: '0',
  SEED_DEMO_RECORDS: '1',
  ALLOW_DEMO_RESET: '1',
});

export const TEST_ENV: AppConfig = loadConfig(process.env);

/**
 * Production-shaped config. All fail-fast requirements are satisfied, but the
 * app receives a capturing fake mailer (never this webhook).
 */
export const PROD_ENV: AppConfig = loadConfig({
  APP_ENV: 'production',
  NODE_ENV: 'production',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  PUBLIC_BASE_URL: TEST_PUBLIC_BASE_URL,
  MFA_ENC_KEY: TEST_MFA_KEY,
  ADMIN_EMAIL: TEST_ADMIN_EMAIL,
  ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
  MAIL_TRANSPORT: 'webhook',
  MAIL_WEBHOOK_URL: 'http://127.0.0.1:9/unused-mail-webhook',
  MAIL_FROM: 'AI Learning Portal <no-reply@example.com>',
  LOG_LEVEL: 'silent',
  SERVE_WEB: '0',
  TRUST_PROXY: '0',
});