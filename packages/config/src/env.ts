import { z } from 'zod';

export const APP_ENVS = ['development', 'test', 'production'] as const;
export const AppEnvSchema = z.enum(APP_ENVS);
export type AppEnv = z.infer<typeof AppEnvSchema>;

export const MAIL_TRANSPORTS = ['webhook', 'smtp', 'console'] as const;
export const MailTransportSchema = z.enum(MAIL_TRANSPORTS);
export type MailTransport = z.infer<typeof MailTransportSchema>;

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const LogLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const DEFAULT_API_PORT = 8787;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_MAIL_FROM = 'AI Learning Portal <no-reply@example.com>';
export const DEV_DATABASE_URL = 'postgres://portal:portal@127.0.0.1:5433/ai_portal';
export const DEV_REDIS_URL = 'redis://127.0.0.1:6380/0';
export const DEV_PUBLIC_BASE_URL = 'http://127.0.0.1:5173';
export const DEV_ADMIN_EMAIL = 'admin@example.com';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts `1/0`, `true/false`, `yes/no`, `on/off` (case-insensitive). */
export function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return undefined;
}

const booleanEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return defaultValue;
    const parsed = parseBoolean(value);
    return parsed === undefined ? value : parsed;
  }, z.boolean());

const trimmedString = z.string().trim();
const requiredString = trimmedString.min(1);
const optionalString = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  trimmedString.min(1).optional(),
);

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^\s/]+(?:[/?#]\S*)?$/i;

const publicBaseUrl = trimmedString
  .min(1)
  .refine((value) => URL_PATTERN.test(value), 'PUBLIC_BASE_URL 必须是合法 URL');

const adminEmail = trimmedString
  .min(1)
  .max(160)
  .regex(EMAIL_PATTERN, 'ADMIN_EMAIL 不是合法邮箱');

/**
 * Environment contract for the API. Defaults are development-safe; production
 * requirements are enforced in `superRefine` (see `parseEnv` for injection).
 */
export const EnvSchema = z
  .object({
    APP_ENV: AppEnvSchema.default('development'),
    NODE_ENV: requiredString.default('development'),
    HOST: trimmedString.min(1).default(DEFAULT_HOST),
    PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_API_PORT),
    DATABASE_URL: requiredString,
    MIGRATION_DATABASE_URL: optionalString,
    REDIS_URL: requiredString,
    PUBLIC_BASE_URL: publicBaseUrl,
    ADMIN_EMAIL: adminEmail.default(DEV_ADMIN_EMAIL),
    ADMIN_PASSWORD: z.string().default(''),
    MFA_ENC_KEY: z.string().default(''),
    MAIL_TRANSPORT: MailTransportSchema.default('console'),
    MAIL_WEBHOOK_URL: trimmedString.default(''),
    MAIL_WEBHOOK_TOKEN: z.string().default(''),
    MAIL_FROM: trimmedString.min(1).default(DEFAULT_MAIL_FROM),
    SEED_DEMO_RECORDS: booleanEnv(true),
    ALLOW_DEMO_RESET: booleanEnv(true),
    LOG_LEVEL: LogLevelSchema.default('info'),
    ENABLE_API_DOCS: booleanEnv(false),
    SERVE_WEB: booleanEnv(true),
    TRUST_PROXY: booleanEnv(false),
  })
  .superRefine((env, ctx) => {
    const production = env.APP_ENV === 'production' || env.NODE_ENV === 'production';
    if (!production) return;

    const requireProduction = (key: 'DATABASE_URL' | 'REDIS_URL' | 'PUBLIC_BASE_URL' | 'ADMIN_PASSWORD' | 'MFA_ENC_KEY') => {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `生产环境必须设置 ${key}`,
        });
      }
    };

    requireProduction('DATABASE_URL');
    requireProduction('REDIS_URL');
    requireProduction('PUBLIC_BASE_URL');
    requireProduction('MFA_ENC_KEY');
    requireProduction('ADMIN_PASSWORD');

    if (env.MAIL_TRANSPORT === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: '生产环境必须配置可用的邮件传输（webhook 或 smtp）',
      });
    } else if (env.MAIL_TRANSPORT === 'webhook' && !env.MAIL_WEBHOOK_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_WEBHOOK_URL'],
        message: 'MAIL_TRANSPORT=webhook 时必须设置 MAIL_WEBHOOK_URL',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

// This package intentionally avoids a Node type dependency; declare the one
// global it reads. Callers normally pass `process.env` explicitly.
declare const process: { env: Record<string, string | undefined> } | undefined;

const runtimeEnv = (): Record<string, string | undefined> =>
  typeof process === 'undefined' ? {} : process.env;

/**
 * Parse and validate environment variables. Development fills safe local
 * defaults; production fails fast when a required value is missing.
 */
export function parseEnv(env: Record<string, string | undefined> = runtimeEnv()): Env {
  const input: Record<string, string | undefined> = { ...env };
  const production = input.APP_ENV === 'production' || input.NODE_ENV === 'production';

  if (input.APP_ENV === undefined || input.APP_ENV === '') {
    input.APP_ENV =
      input.NODE_ENV && (APP_ENVS as readonly string[]).includes(input.NODE_ENV)
        ? input.NODE_ENV
        : 'development';
  }
  if (input.NODE_ENV === undefined || input.NODE_ENV === '') {
    input.NODE_ENV = input.APP_ENV;
  }

  const setDefault = (key: string, value: string) => {
    const current = input[key];
    if (current === undefined || current === null || current === '') input[key] = value;
  };

  setDefault('HOST', DEFAULT_HOST);
  setDefault('PORT', String(DEFAULT_API_PORT));
  setDefault('LOG_LEVEL', 'info');
  setDefault('ENABLE_API_DOCS', '0');
  setDefault('MAIL_FROM', DEFAULT_MAIL_FROM);

  if (production) {
    setDefault('SEED_DEMO_RECORDS', '0');
    setDefault('ALLOW_DEMO_RESET', '0');
    setDefault('SERVE_WEB', '0');
    setDefault('TRUST_PROXY', '1');
    setDefault('MAIL_TRANSPORT', 'webhook');
    setDefault('ADMIN_EMAIL', DEV_ADMIN_EMAIL);

    const problems: string[] = [];
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'PUBLIC_BASE_URL', 'MFA_ENC_KEY', 'ADMIN_PASSWORD'] as const) {
      if (!input[key]) problems.push(`生产环境必须设置 ${key}`);
    }
    if (input.MAIL_TRANSPORT === 'console') {
      problems.push('生产环境必须配置可用的邮件传输（webhook 或 smtp）');
    } else if (input.MAIL_TRANSPORT === 'webhook' && !input.MAIL_WEBHOOK_URL) {
      problems.push('MAIL_TRANSPORT=webhook 时必须设置 MAIL_WEBHOOK_URL');
    }
    if (problems.length > 0) {
      throw new Error(`生产环境配置不完整：\n- ${problems.join('\n- ')}`);
    }
  } else {
    setDefault('DATABASE_URL', DEV_DATABASE_URL);
    setDefault('REDIS_URL', DEV_REDIS_URL);
    setDefault('PUBLIC_BASE_URL', DEV_PUBLIC_BASE_URL);
    setDefault('ADMIN_EMAIL', DEV_ADMIN_EMAIL);
    setDefault('SEED_DEMO_RECORDS', '1');
    setDefault('ALLOW_DEMO_RESET', '1');
    setDefault('SERVE_WEB', '1');
    setDefault('TRUST_PROXY', '0');
    setDefault('MAIL_TRANSPORT', 'console');
  }

  return EnvSchema.parse(input);
}