import type { InsightType } from '@/api/types';

/** v1 accent colours, keyed by insight type. */
export const INSIGHT_ACCENT: Record<InsightType, string> = {
  progress: '#2F78C4',
  correlation: '#06C7CC',
  timing: '#E8833A',
  quality: '#D64545',
  comparison: '#6C5CE7',
};

export function insightAccent(type: InsightType): string {
  return INSIGHT_ACCENT[type] ?? '#2F78C4';
}
