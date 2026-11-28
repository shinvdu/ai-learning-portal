/**
 * Capturing mailer used in place of the console/webhook transports.
 *
 * The API only calls `send()`; the fake records every message so tests can
 * read verification/reset links out of the body and assert on recipients.
 */
import type { MailMessage, Mailer, MailResult } from '../../src/lib/types.js';

export type CapturingMailer = Mailer & {
  messages: MailMessage[];
  clear(): void;
  lastTo(email: string): MailMessage | undefined;
  tokenFor(email: string, kind: 'verify' | 'reset'): string | undefined;
};

const TOKEN_PATTERN = /token=([A-Za-z0-9_-]+)/;

export function createCapturingMailer(): CapturingMailer {
  const messages: MailMessage[] = [];

  return {
    messages,
    async send(message: MailMessage): Promise<MailResult> {
      messages.push(message);
      return { mode: 'capture' };
    },
    clear(): void {
      messages.length = 0;
    },
    lastTo(email: string): MailMessage | undefined {
      const wanted = email.trim().toLowerCase();
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]!;
        if (message.to.trim().toLowerCase() === wanted) return message;
      }
      return undefined;
    },
    tokenFor(email: string, kind: 'verify' | 'reset'): string | undefined {
      const message = this.lastTo(email);
      const text = message?.text ?? '';
      if (!text.includes(`#/${kind}?`)) return undefined;
      return TOKEN_PATTERN.exec(text)?.[1];
    },
  };
}