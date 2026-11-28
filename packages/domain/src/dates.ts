/** Strict ISO calendar-date helpers (no timezone drift). */

/** `YYYY-MM-DD` shape only; calendar validity is checked separately. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in `YYYY-MM-DD` form.
 * Rejects impossible dates such as `2026-02-31` and non-padded input.
 */
export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parts = value.split('-').map(Number);
  const [y, m, d] = parts;
  if (y === undefined || m === undefined || d === undefined) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}