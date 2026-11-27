/**
 * Minimal mail adapter.
 *
 * - MAIL_WEBHOOK_URL: POST the message as JSON to an email relay (Resend,
 *   SendGrid, internal SMTP relay, etc.). Requires MAIL_WEBHOOK_TOKEN if the
 *   relay expects a bearer token.
 * - Otherwise (development only): print the message and links to the console.
 * - APP_ENV=production refuses to silently print verification/reset tokens.
 */

export function appBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;
  return String(raw).replace(/\/+$/, '');
}

export function verificationUrl(token) {
  return `${appBaseUrl()}/#/verify?token=${encodeURIComponent(token)}`;
}

export function passwordResetUrl(token) {
  return `${appBaseUrl()}/#/reset?token=${encodeURIComponent(token)}`;
}

export async function sendMail({ to, subject, text, html }) {
  const webhook = process.env.MAIL_WEBHOOK_URL;
  if (webhook) {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.MAIL_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.MAIL_WEBHOOK_TOKEN}`;
    const res = await fetch(webhook, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'no-reply@ai-learning-portal.local',
        to,
        subject,
        text,
        html: html ?? undefined
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`邮件网关返回 ${res.status}`);
    return { mode: 'webhook' };
  }

  if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('生产环境需要配置 MAIL_WEBHOOK_URL 才能发送验证/重置邮件');
  }
  console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n[mail] ${text}\n`);
  return { mode: 'console' };
}