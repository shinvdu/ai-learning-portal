/**
 * Zod validation middleware.
 *
 * `validateBody(schema)` replaces `req.body` with the parsed value.
 * `validateQuery(schema)` / `validateParams(schema)` expose the parsed value on
 * `req.validatedQuery` / `req.validatedParams` (Express 5 makes `req.query`
 * read-only). Failures become 400 responses with an `errors[]` list.
 */
import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { zodErrorToAppError } from '../lib/errors.js';

export type ValidationSource = 'body' | 'query' | 'params';

export function validate(schema: ZodType, source: ValidationSource = 'body'): RequestHandler {
  return (req, _res, next) => {
    const input = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
    const result = schema.safeParse(input);
    if (!result.success) {
      next(zodErrorToAppError(result.error));
      return;
    }
    if (source === 'body') req.body = result.data;
    else if (source === 'query') req.validatedQuery = result.data;
    else req.validatedParams = result.data;
    next();
  };
}

export function validateBody(schema: ZodType): RequestHandler {
  return validate(schema, 'body');
}

export function validateQuery(schema: ZodType): RequestHandler {
  return validate(schema, 'query');
}

export function validateParams(schema: ZodType): RequestHandler {
  return validate(schema, 'params');
}