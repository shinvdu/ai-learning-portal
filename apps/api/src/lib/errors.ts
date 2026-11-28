/**
 * Unified API error envelope.
 *
 * v1 responses are `{error}` with optional `errors[]` (validation) and `code`
 * (auth/mail special cases). `AppError` is the single source of truth for the
 * status/message/code triple; the central error handler serialises it and the
 * `zodErrorToAppError` helper maps Zod failures to 400 + `errors[]`.
 */
import { ZodError, type ZodIssue } from 'zod';

export type ErrorEnvelope = {
  error: string;
  errors?: string[];
  code?: string;
};

export class AppError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly errors: string[] | undefined;

  constructor(status: number, message: string, code?: string, errors?: string[]) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.errors = errors && errors.length > 0 ? [...errors] : undefined;
  }

  toEnvelope(): ErrorEnvelope {
    const envelope: ErrorEnvelope = { error: this.message };
    if (this.errors && this.errors.length > 0) envelope.errors = [...this.errors];
    if (this.code) envelope.code = this.code;
    return envelope;
  }
}

export const badRequest = (message: string, errors?: string[], code?: string): AppError =>
  new AppError(400, message, code, errors);

export const unauthorized = (message = '请先登录', code?: string): AppError =>
  new AppError(401, message, code);

export const forbidden = (message = '需要管理员权限', code?: string): AppError =>
  new AppError(403, message, code);

export const notFound = (message = '接口不存在'): AppError => new AppError(404, message);

export const conflict = (message: string): AppError => new AppError(409, message);

export const payloadTooLarge = (message = '请求体超过 2MB 限制'): AppError =>
  new AppError(413, message);

export const locked = (message = '账号已临时锁定，请 15 分钟后再试'): AppError =>
  new AppError(423, message);

export const tooManyRequests = (message = '尝试次数过多，请稍后再试'): AppError =>
  new AppError(429, message);

export const badGateway = (message: string, code?: string): AppError =>
  new AppError(502, message, code);

/** Format a Zod issue into a v1-style validation message. */
export function issueMessage(issue: ZodIssue): string {
  return issue.message;
}

/** Convert a Zod parsing failure into a 400 AppError with a deduplicated list. */
export function zodErrorToAppError(error: ZodError): AppError {
  const messages: string[] = [];
  for (const issue of error.issues) {
    const message = issueMessage(issue) || '请求参数不合法';
    if (!messages.includes(message)) messages.push(message);
  }
  const first = messages[0] ?? '请求参数不合法';
  return badRequest(first, messages.length > 0 ? messages : undefined);
}