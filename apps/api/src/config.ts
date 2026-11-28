/**
 * API configuration: a thin, fail-fast wrapper around `@portal/config`.
 *
 * `parseEnv` already applies development-safe defaults and enforces the
 * production requirements (DATABASE_URL, REDIS_URL, PUBLIC_BASE_URL,
 * MFA_ENC_KEY, ADMIN_PASSWORD, a non-console mail transport). This module only
 * adds a typed `loadConfig` entry point and a readable error message so the
 * process stops at start-up instead of failing on the first request.
 */
import { ZodError } from 'zod';
import { parseEnv, type Env } from '@portal/config';

/** The validated environment object shared by the app and all middleware. */
export type AppConfig = Env;

export type { Env };

/** True when either conventional production flag is set. */
export function isProduction(config: Pick<Env, 'APP_ENV' | 'NODE_ENV'>): boolean {
  return config.APP_ENV === 'production' || config.NODE_ENV === 'production';
}

function describe(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      })
      .join('\n- ');
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Validate the environment and return the typed config.
 *
 * Development fills safe local defaults (database/redis on the workshop ports,
 * console mail, SERVE_WEB=1). Production throws when a required value is
 * missing or the mail transport is unusable.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  try {
    return parseEnv(source);
  } catch (error) {
    const detail = describe(error);
    throw new Error(
      `配置校验失败，无法启动 API：\n- ${detail}\n请检查环境变量（参考 .env.example）。`,
    );
  }
}