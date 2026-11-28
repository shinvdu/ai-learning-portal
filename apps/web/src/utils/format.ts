/** Display helpers ported from v1 `public/js/app.js` (same rounding rules). */

export function clampPercent(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Integer when exact, otherwise one decimal; em dash for null/undefined. */
export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function dec1(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

export function shortDate(date: string | null | undefined): string {
  return date ? date.slice(5) : '';
}

const SOURCE_LABELS: Record<string, string> = {
  'seed-reset': '初始种子数据',
  'csv-import': 'CSV 导入',
  'manual-import': '手工导入',
  seed: '种子数据',
};

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return SOURCE_LABELS[source] ?? source;
}

/** ISO timestamp → zh-CN local string, `—` when unparseable/empty. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

/** Epoch milliseconds → zh-CN local string. */
export function fmtEpoch(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return fmtTime(new Date(ms).toISOString());
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}