import { z } from 'zod';
import { optionalQueryString, paginatedSchema } from './common.js';

function boundedIntQuery(min: number, max: number, defaultValue: number) {
  return z.preprocess(
    (value) =>
      value === undefined || value === null || value === ''
        ? defaultValue
        : typeof value === 'string'
          ? Number(value)
          : value,
    z.number().int().min(min).max(max),
  );
}

export const AuditQuerySchema = z.object({
  limit: boundedIntQuery(1, 200, 50),
  offset: boundedIntQuery(0, Number.MAX_SAFE_INTEGER, 0),
  action: optionalQueryString,
});

export type AuditQuery = z.infer<typeof AuditQuerySchema>;

/** One append-only audit_log row (v1 column names). */
export const AuditRowSchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  actor_user_id: z.number().int().nullable(),
  actor_email: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  ip: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
});

export type AuditRow = z.infer<typeof AuditRowSchema>;

export const AuditResponseSchema = paginatedSchema(AuditRowSchema);
export type AuditResponse = z.infer<typeof AuditResponseSchema>;