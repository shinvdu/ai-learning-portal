/**
 * Rounding helpers shared by every metric.
 *
 * `round1` reproduces the v1 half-up behaviour exactly: `81.25 -> 81.3`.
 * The `+1e-9` nudge counteracts floating point representation error.
 */

/** Round to one decimal; returns null for null/undefined/NaN. */
export function round1(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round((value + 1e-9) * 10) / 10;
}

/** Arithmetic mean; null for an empty list (never divides by zero). */
export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Sum; an empty list is 0 (matches `Array#reduce` with initial 0). */
export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}