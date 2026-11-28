import { z } from 'zod';

/**
 * Error envelope used by every failing API response.
 * Validation failures add `errors[]`; auth/mail failures add `code`.
 */
export const ApiErrorSchema = z.object({
  error: z.string(),
  errors: z.array(z.string()).optional(),
  code: z.string().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Shared `limit`/`offset` query fields (offset pagination). */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** v1 paginated response: `{ total, limit, offset, rows }` (+ optional `hasMore`). */
export function paginatedSchema<TRow extends z.ZodTypeAny>(row: TRow) {
  return z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    rows: z.array(row),
    hasMore: z.boolean().optional(),
  });
}

/** Pagination metadata without the row array. */
export const PaginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean().optional(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/** Alias for `paginatedSchema`, e.g. `PaginationSchema(RecordRowSchema)`. */
export { paginatedSchema as PaginationSchema };

export const SimpleOkResponseSchema = z.object({
  ok: z.literal(true),
});

export type SimpleOkResponse = z.infer<typeof SimpleOkResponseSchema>;

/** `/healthz` v1 response. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** `/healthz` v1 shape used by the zero-dependency server. */
export const HealthzResponseSchema = z.object({
  ok: z.literal(true),
  uptime: z.number().nonnegative(),
});

export type HealthzResponse = z.infer<typeof HealthzResponseSchema>;

/** `/readyz` v1 shape. */
export const ReadyzResponseSchema = z.object({
  ok: z.boolean(),
});

export type ReadyzResponse = z.infer<typeof ReadyzResponseSchema>;

/** Strips empty query strings so optional filters behave like v1 (`q || ''`). */
export const optionalQueryString = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  z.string().optional(),
);