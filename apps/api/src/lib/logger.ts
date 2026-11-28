/**
 * Structured JSON logging (pino) with sensitive-field redaction.
 *
 * `createLogger` is used by `index.ts`; the request/response serializers are
 * reused by `pino-http` so every request log carries the correlation id,
 * method, path and client address without cookies, bearer tokens or bodies.
 */
import pino, { type LogFn, type Logger, type LoggerOptions } from 'pino';
import type { Env } from '@portal/config';

/**
 * Requests slower than this are re-emitted at `warn` even when pino-http
 * chooses `info` because the status code is successful (F093).
 */
export const SLOW_REQUEST_MS = 500;

type SerializableRequest = {
  id?: unknown;
  method?: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
};

type SerializableResponse = {
  statusCode?: number;
};

/** Redact credentials everywhere they could appear in a log object. */
export const REDACT_PATHS: string[] = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'cookie',
  'authorization',
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'challengeToken',
  'code',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.challengeToken',
  '*.code',
  'body.password',
  'body.currentPassword',
  'body.newPassword',
  'body.token',
  'body.challengeToken',
  'body.code',
];

export function requestSerializer(req: SerializableRequest): Record<string, unknown> {
  return {
    id: req.id,
    method: req.method,
    url: req.originalUrl ?? req.url,
    ip: req.ip ?? req.socket?.remoteAddress,
  };
}

export function responseSerializer(res: SerializableResponse): Record<string, unknown> {
  return { statusCode: res.statusCode };
}

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'APP_ENV'>): Logger {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: { service: 'ai-learning-portal-api', env: env.APP_ENV },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      req: requestSerializer,
      res: responseSerializer,
      err: pino.stdSerializers.err,
    },
    hooks: {
      /**
       * `pino-http` picks `info` for successful responses regardless of how
       * long they took. Re-dispatch slow ones at `warn` so operators can alert
       * on `level>=40` and `responseTime>500`. The `level === 30` guard stops
       * the re-dispatched `warn` from recursing through this hook again.
       */
      logMethod(args, method, level) {
        const record = args[0] as { responseTime?: unknown } | undefined;
        const slow =
          typeof record === 'object' &&
          record !== null &&
          typeof record.responseTime === 'number' &&
          record.responseTime > SLOW_REQUEST_MS;
        if (slow && level === 30) {
          return (this.warn as LogFn).apply(this, args);
        }
        return method.apply(this, args);
      },
    },
  };
  return pino(options);
}