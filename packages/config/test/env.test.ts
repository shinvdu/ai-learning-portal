import { describe, expect, it } from 'vitest';
import {
  BODY_LIMIT_BYTES,
  CSRF_COOKIE_NAME,
  MFA_CHALLENGE_TTL_MS,
  RESET_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  VERIFY_TTL_MS,
  parseBoolean,
  parseEnv,
} from '../src/index.js';

describe('parseEnv (development)', () => {
  it('fills safe local defaults and coerces types', () => {
    const env = parseEnv({});

    expect(env.APP_ENV).toBe('development');
    expect(env.NODE_ENV).toBe('development');
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe(8787);
    expect(env.DATABASE_URL).toBe('postgres://portal:portal@127.0.0.1:5433/ai_portal');
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6380/0');
    expect(env.PUBLIC_BASE_URL).toBe('http://127.0.0.1:5173');
    expect(env.ADMIN_EMAIL).toBe('admin@example.com');
    expect(env.MAIL_TRANSPORT).toBe('console');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SEED_DEMO_RECORDS).toBe(true);
    expect(env.ALLOW_DEMO_RESET).toBe(true);
    expect(env.SERVE_WEB).toBe(true);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.ENABLE_API_DOCS).toBe(false);
  });
});

describe('parseEnv (production)', () => {
  it('fails fast when required variables are missing', () => {
    expect(() => parseEnv({ APP_ENV: 'production' })).toThrow();
    try {
      parseEnv({ APP_ENV: 'production' });
    } catch (error) {
      const message = String((error as Error).message);
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('MFA_ENC_KEY');
    }
  });

  it('still rejects console mail transport even with other secrets set', () => {
    const base = {
      APP_ENV: 'production',
      DATABASE_URL: 'postgres://portal:portal@db:5432/ai_portal',
      REDIS_URL: 'redis://redis:6379/0',
      PUBLIC_BASE_URL: 'https://learning.example.com',
      ADMIN_PASSWORD: 'a-long-random-password',
      MFA_ENC_KEY: 'unused-test-key',
    };

    expect(() => parseEnv({ ...base, MAIL_TRANSPORT: 'console' })).toThrow();
    expect(parseEnv({ ...base, MAIL_TRANSPORT: 'webhook', MAIL_WEBHOOK_URL: 'https://mail.example.com/send' })).toMatchObject({
      SEED_DEMO_RECORDS: false,
      ALLOW_DEMO_RESET: false,
      SERVE_WEB: false,
      TRUST_PROXY: true,
    });
  });
});

describe('boolean parsing', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['YES', true],
    ['on', true],
    ['0', false],
    ['false', false],
    ['no', false],
    ['OFF', false],
  ])('parses %s as %s', (input, expected) => {
    expect(parseBoolean(input)).toBe(expected);
  });

  it('rejects unknown boolean strings', () => {
    expect(parseBoolean('maybe')).toBeUndefined();
    expect(() =>
      parseEnv({ SEED_DEMO_RECORDS: 'maybe', APP_ENV: 'development' }),
    ).toThrow();
  });

  it('lets explicit values override defaults', () => {
    const env = parseEnv({
      APP_ENV: 'development',
      SEED_DEMO_RECORDS: '0',
      ALLOW_DEMO_RESET: 'no',
      SERVE_WEB: '0',
      TRUST_PROXY: '1',
      ENABLE_API_DOCS: '1',
      PORT: '9999',
    });

    expect(env.SEED_DEMO_RECORDS).toBe(false);
    expect(env.ALLOW_DEMO_RESET).toBe(false);
    expect(env.SERVE_WEB).toBe(false);
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.ENABLE_API_DOCS).toBe(true);
    expect(env.PORT).toBe(9999);
  });
});

describe('runtime constants', () => {
  it('matches the agreed lifetimes, limits and cookie names', () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(VERIFY_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
    expect(MFA_CHALLENGE_TTL_MS).toBe(5 * 60 * 1000);
    expect(BODY_LIMIT_BYTES).toBe(2 * 1024 * 1024);
    expect(SESSION_COOKIE_NAME).toBe('aip_session');
    expect(CSRF_COOKIE_NAME).toBe('aip_csrf');
  });
});