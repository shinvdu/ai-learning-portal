/**
 * Offset pagination parsing with v1 caps.
 *
 * Records: 1–200, default 20. Audit: 1–200, default 50. Invalid or empty
 * values fall back to the default rather than erroring, matching the v1
 * `Number(value) || default` behaviour.
 */
export type PaginationOptions = {
  defaultLimit: number;
  maxLimit: number;
  minLimit?: number;
};

export const RECORDS_PAGINATION: PaginationOptions = { defaultLimit: 20, maxLimit: 200 };
export const AUDIT_PAGINATION: PaginationOptions = { defaultLimit: 50, maxLimit: 200 };

export type Pagination = { limit: number; offset: number };

function toInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

export function parsePagination(
  query: Record<string, unknown> | undefined,
  options: PaginationOptions,
): Pagination {
  const minLimit = options.minLimit ?? 1;
  const rawLimit = toInteger(query?.limit);
  const rawOffset = toInteger(query?.offset);

  const limit = Math.min(options.maxLimit, Math.max(minLimit, rawLimit ?? options.defaultLimit));
  const offset = Math.max(0, rawOffset ?? 0);
  return { limit, offset };
}

/** Apply the same cap rules to a raw limit value (e.g. a validated query). */
export function clampLimit(value: number | undefined, options: PaginationOptions): number {
  const minLimit = options.minLimit ?? 1;
  return Math.min(options.maxLimit, Math.max(minLimit, value ?? options.defaultLimit));
}