import { describe, expect, it } from 'vitest';
import { DATE_RE, isCalendarDate } from '../src/index.js';

describe('isCalendarDate', () => {
  it('accepts strict real dates', () => {
    expect(isCalendarDate('2026-11-04')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(DATE_RE.test('2026-11-04')).toBe(true);
  });

  it('rejects impossible calendar dates', () => {
    expect(isCalendarDate('2026-02-31')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-00-10')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2025-02-29')).toBe(false);
  });

  it('rejects malformed shapes', () => {
    expect(isCalendarDate('')).toBe(false);
    expect(isCalendarDate('2026-1-01')).toBe(false);
    expect(isCalendarDate('2026/11/04')).toBe(false);
    expect(isCalendarDate('2026-11-04 ')).toBe(false);
    expect(isCalendarDate('2026-11-04T00:00:00Z')).toBe(false);
    expect(DATE_RE.test('26-11-04')).toBe(false);
  });
});