/**
 * Mail adapters (F049).
 *
 * - `webhook` (production default): `POST {from,to,subject,text,html}` with an
 *   optional `Authorization: Bearer <MAIL_WEBHOOK_TOKEN>` header and a 10s
 *   timeout. Any non-2xx response throws, so callers can return 502
 *   `MAIL_FAILED` and keep the account.
 * - `console`: development/test only. Logs recipient and subject, never the
 *   body, because verification/reset links contain single-use secrets.
 * - `smtp`: P1. Configuration is refused at start-up with a clear message
 *   instead of silently falling back to another transport.
 *
 * Production must never use the console transport; the environment schema
 * already rejects it, and `createMailer` double-checks.
 */
import type { Env } from '@portal/config';
import type { Logger } from 'pino';
import type { Mailer, MailMessage, MailResult } from '../../lib/types.js';

export type MailerEnv = Pick<
  Env,
  | 'APP_ENV'
  | 'NODE_ENV'
  | 'MAIL_TRANSPORT'
  | 'MAIL_WEBHOOK_URL'
  | 'MAIL_WEBHOOK_TOKEN'
  | 'MAIL_FROM'
  | 'PUBLIC_BASE_URL'
>;

const WEBHOOK_TIMEOUT_MS = 10_000;

function isProduction(env: Pick<MailerEnv, 'APP_ENV' | 'NODE_ENV'>): boolean {
  return env.APP_ENV === 'production' || env.NODE_ENV === 'production';
}

/** `PUBLIC_BASE_URL` without trailing slashes, or a localhost fallback. */
export function appBaseUrl(env: Pick<Env, 'PUBLIC_BASE_URL'>): string {
  return String(env.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
}

/** v1 hash-route link; the SPA redirects to the history route. */
export function verificationUrl(env: Pick<Env, 'PUBLIC_BASE_URL'>, token: string): string {
  return `${appBaseUrl(env)}/#/verify?token=${encodeURIComponent(token)}`;
}

export function passwordResetUrl(env: Pick<Env, 'PUBLIC_BASE_URL'>, token: string): string {
  return `${appBaseUrl(env)}/#/reset?token=${encodeURIComponent(token)}`;
}

/**
 * Build the process-wide mailer. Throws at start-up when the configured
 * transport cannot work, so the API never runs with unreachable mail.
 */
export function createMailer(env: MailerEnv, logger: Logger): Mailer {
  const production = isProduction(env);

  if (env.MAIL_TRANSPORT === 'smtp') {
    throw new Error(
      'SMTP 未配置：SMTP 传输尚未实现（P1）。请改用 MAIL_TRANSPORT=webhook 并设置 MAIL_WEBHOOK_URL。',
    );
  }

  if (env.MAIL_TRANSPORT === 'webhook') {
    if (!env.MAIL_WEBHOOK_URL) {
      throw new Error('MAIL_TRANSPORT=webhook 时必须设置 MAIL_WEBHOOK_URL');
    }
  } else if (env.MAIL_TRANSPORT === 'console' && production) {
    throw new Error('生产环境禁止使用 console 邮件传输，请配置 webhook（或后续的 SMTP）');
  }

  const from = env.MAIL_FROM || 'AI Learning Portal <no-reply@example.com>';

  return {
    async send(message: MailMessage): Promise<MailResult> {
      if (env.MAIL_TRANSPORT === 'console') {
        // Recipient + subject only; the body holds single-use tokens.
        logger.info(
          { to: message.to, subject: message.subject },
          'console mail transport: message not sent',
        );
        return { mode: 'console' };
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (env.MAIL_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${env.MAIL_WEBHOOK_TOKEN}`;

      const response = await fetch(env.MAIL_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: message.from ?? from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });

      if (!response.ok) throw new Error(`邮件网关返回 ${response.status}`);
      return { mode: 'webhook' };
    },
  };
}