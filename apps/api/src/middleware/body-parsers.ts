/**
 * Request body parsers with the v1 2MB cap.
 *
 * JSON (`application/json`) and CSV/plain text (`text/csv`, `text/plain`) are
 * parsed. The central error handler maps body-parser failures:
 * `entity.too.large` → 413 `请求体超过 2MB 限制`, `entity.parse.failed` → 400
 * `请求体不是合法 JSON`.
 */
import express from 'express';
import { BODY_LIMIT_BYTES } from '@portal/config';
import { AppError, badRequest, payloadTooLarge } from '../lib/errors.js';

export const jsonBodyParser = express.json({ limit: BODY_LIMIT_BYTES });
export const textBodyParser = express.text({
  type: ['text/csv', 'text/plain'],
  limit: BODY_LIMIT_BYTES,
});

export const bodyParsers = [jsonBodyParser, textBodyParser];

type BodyParserError = Error & { type?: string; status?: number; statusCode?: number };

/** Map an Express body-parser error to the v1 status/message, if it is one. */
export function bodyParserError(error: unknown): AppError | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as BodyParserError;
  const status = candidate.status ?? candidate.statusCode;
  const type = candidate.type;

  if (type === 'entity.too.large' || status === 413) {
    return payloadTooLarge();
  }
  if (type === 'entity.parse.failed' || (candidate instanceof SyntaxError && status === 400)) {
    return badRequest('请求体不是合法 JSON');
  }
  if (type === 'charset.unsupported' || status === 415) {
    return new AppError(415, '不支持的请求体编码');
  }
  return undefined;
}