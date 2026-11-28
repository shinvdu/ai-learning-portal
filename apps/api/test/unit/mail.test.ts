/**
 * Unit tests for the mail adapters (F049).
 *
 * No network and no database: `fetch` is stubbed for the webhook transport,
 * and SMTP uses an injected fake transport plus nodemailer's real stream
 * transport (which renders the MIME message in memory).
 */
import type { Logger } from 'pino';
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMailer,
  type MailerEnv,
  type SmtpMail,
  type SmtpTransport,
  type SmtpTransportFactory,
} from '../../src/modules/auth/mail.js';

const SMTP_URL = 'smtp://portal:secret@mail.example.test:587';

function makeEnv(overrides: Partial<MailerEnv> = {}): MailerEnv {
  const base: MailerEnv = {
    APP_ENV: 'test',
    NODE_ENV: 'test',
    MAIL_TRANSPORT: 'console',
    MAIL_WEBHOOK_URL: '',
    MAIL_WEBHOOK_TOKEN: '',
    MAIL_FROM: 'AI Learning Portal <no-reply@example.com>',
    PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
    SMTP_URL: undefined,
  };
  return { ...base, ...overrides };
}

function makeLogger(): Logger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as Logger & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
}

function makeFakeTransport(): { transport: SmtpTransport; sent: SmtpMail[] } {
  const sent: SmtpMail[] = [];
  const transport: SmtpTransport = {
    async sendMail(mail: SmtpMail): Promise<unknown> {
      sent.push(mail);
      return { messageId: 'fake-message-id' };
    },
  };
  return { transport, sent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('console transport', () => {
  it('logs recipient and subject but never the message body', async () => {
    const logger = makeLogger();
    const mailer = createMailer(makeEnv({ MAIL_TRANSPORT: 'console' }), logger);

    const result = await mailer.send({
      to: 'student@example.com',
      subject: 'Verify your account',
      text: 'Open http://127.0.0.1:8787/#/verify?token=super-secret-token',
      html: '<a href="http://127.0.0.1:8787/#/verify?token=super-secret-token">verify</a>',
    });

    expect(result).toEqual({ mode: 'console' });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [context, message] = logger.info.mock.calls[0] as [object, string];
    expect(context).toEqual({ to: 'student@example.com', subject: 'Verify your account' });
    expect(message).toContain('not sent');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('super-secret-token');
  });

  it('is rejected in production', () => {
    expect(() => createMailer(makeEnv({ APP_ENV: 'production', NODE_ENV: 'production' }), makeLogger())).toThrow(
      /console/,
    );
  });
});

describe('webhook transport', () => {
  it('keeps the POST {from,to,subject,text,html} contract with the bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const mailer = createMailer(
      makeEnv({
        MAIL_TRANSPORT: 'webhook',
        MAIL_WEBHOOK_URL: 'http://127.0.0.1:9/mail',
        MAIL_WEBHOOK_TOKEN: 'gateway-token',
      }),
      makeLogger(),
    );

    const result = await mailer.send({
      to: 'student@example.com',
      subject: 'Reset your password',
      text: 'reset body',
      html: '<p>reset body</p>',
    });

    expect(result).toEqual({ mode: 'webhook' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:9/mail');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer gateway-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'AI Learning Portal <no-reply@example.com>',
      to: 'student@example.com',
      subject: 'Reset your password',
      text: 'reset body',
      html: '<p>reset body</p>',
    });
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream down', { status: 502 })),
    );
    const mailer = createMailer(
      makeEnv({ MAIL_TRANSPORT: 'webhook', MAIL_WEBHOOK_URL: 'http://127.0.0.1:9/mail' }),
      makeLogger(),
    );

    await expect(mailer.send({ to: 'student@example.com', subject: 's' })).rejects.toThrow(/502/);
  });

  it('requires MAIL_WEBHOOK_URL', () => {
    expect(() => createMailer(makeEnv({ MAIL_TRANSPORT: 'webhook' }), makeLogger())).toThrow(
      /MAIL_WEBHOOK_URL/,
    );
  });
});

describe('smtp transport', () => {
  it('builds the transport from SMTP_URL and forwards the full message', async () => {
    const fake = makeFakeTransport();
    const urls: string[] = [];
    const factory: SmtpTransportFactory = (url) => {
      urls.push(url);
      return fake.transport;
    };

    const mailer = createMailer(makeEnv({ MAIL_TRANSPORT: 'smtp', SMTP_URL }), makeLogger(), {
      smtpTransportFactory: factory,
    });

    const result = await mailer.send({
      to: 'student@example.com',
      subject: 'Verify your account',
      text: 'text body',
      html: '<p>html body</p>',
    });

    expect(result).toEqual({ mode: 'smtp' });
    expect(urls).toEqual([SMTP_URL]);
    expect(fake.sent).toEqual([
      {
        from: 'AI Learning Portal <no-reply@example.com>',
        to: 'student@example.com',
        subject: 'Verify your account',
        text: 'text body',
        html: '<p>html body</p>',
      },
    ]);
  });

  it('honours a per-message from override', async () => {
    const fake = makeFakeTransport();
    const mailer = createMailer(makeEnv({ MAIL_TRANSPORT: 'smtp', SMTP_URL }), makeLogger(), {
      smtpTransportFactory: () => fake.transport,
    });

    await mailer.send({
      from: 'Support <support@example.com>',
      to: 'student@example.com',
      subject: 'Hello',
      text: 'body',
    });

    expect(fake.sent[0]?.from).toBe('Support <support@example.com>');
  });

  it('fails fast when SMTP_URL is missing and never builds a transport', () => {
    const factory = vi.fn<SmtpTransportFactory>(() => makeFakeTransport().transport);

    expect(() =>
      createMailer(makeEnv({ MAIL_TRANSPORT: 'smtp', SMTP_URL: undefined }), makeLogger(), {
        smtpTransportFactory: factory,
      }),
    ).toThrow(/SMTP_URL/);
    expect(factory).not.toHaveBeenCalled();
  });

  it('propagates transport errors without logging the body', async () => {
    const logger = makeLogger();
    const transport: SmtpTransport = {
      async sendMail(): Promise<unknown> {
        throw new Error('550 relay denied');
      },
    };
    const mailer = createMailer(makeEnv({ MAIL_TRANSPORT: 'smtp', SMTP_URL }), logger, {
      smtpTransportFactory: () => transport,
    });

    await expect(
      mailer.send({
        to: 'student@example.com',
        subject: 'Verify your account',
        text: 'token=super-secret-token',
      }),
    ).rejects.toThrow('550 relay denied');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('super-secret-token');
  });

  it('sends through nodemailer stream transport (no network)', async () => {
    type StreamInfo = {
      envelope: { from: string; to: string[] };
      message: Buffer;
      messageId: string;
    };
    let captured: StreamInfo | undefined;

    const factory: SmtpTransportFactory = () => {
      const streamTransport = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        newline: 'unix',
      });
      return {
        async sendMail(mail: SmtpMail): Promise<unknown> {
          captured = (await streamTransport.sendMail(mail)) as unknown as StreamInfo;
          return captured;
        },
      };
    };

    const mailer = createMailer(makeEnv({ MAIL_TRANSPORT: 'smtp', SMTP_URL }), makeLogger(), {
      smtpTransportFactory: factory,
    });

    const result = await mailer.send({
      to: 'student@example.com',
      subject: 'Verify your account',
      text: 'Open the portal to verify.',
      html: '<p>Open the portal to verify.</p>',
    });

    expect(result).toEqual({ mode: 'smtp' });
    expect(captured).toBeDefined();
    const info = captured as StreamInfo;
    expect(info.envelope.from).toBe('no-reply@example.com');
    expect(info.envelope.to).toEqual(['student@example.com']);
    expect(info.messageId).toBeTruthy();
    const raw = info.message.toString();
    expect(raw).toContain('To: student@example.com');
    expect(raw).toContain('Subject: Verify your account');
    expect(raw).toContain('Open the portal to verify.');
  });
});