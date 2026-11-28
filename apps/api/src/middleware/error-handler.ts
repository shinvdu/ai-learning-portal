/**
 * Central error handler. Serialises `AppError` (and mapped Zod/body-parser
 * failures) into the v1 envelope `{error, errors?, code?}`. Unknown 5xx errors
 * return the error message (never the stack) and are logged with the request
 * correlation id.
 */
import type { ErrorRequestHandler, Request } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError, zodErrorToAppError } from '../lib/errors.js';
import { bodyParserError } from './body-parsers.js';

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = (error as { status?: unknown; statusCode?: unknown }).status;
  const fallback = (error as { statusCode?: unknown }).statusCode;
  const value = typeof candidate === 'number' ? candidate : fallback;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return zodErrorToAppError(error);

  const mappedBody = bodyParserError(error);
  if (mappedBody) return mappedBody;

  const status = statusOf(error);
  const message = error instanceof Error && error.message ? error.message : '服务器内部错误';
  if (status !== undefined && status >= 400 && status <= 599) {
    return new AppError(status, message);
  }
  return new AppError(500, message || '服务器内部错误');
}

function logFor(req: Request): Logger | undefined {
  return req.log;
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const appError = toAppError(error);
    if (appError.status >= 500) {
      (logFor(req) ?? logger).error(
        { err: error, requestId: req.requestId, status: appError.status },
        'request failed',
      );
    }
    res.status(appError.status).json(appError.toEnvelope());
  };
}