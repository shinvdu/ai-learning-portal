/**
 * 纯 SVG 图表（零依赖、离线可用）。
 * 设计原则：单色系、留白充足、数值直接标注。
 * compact=true 用于窄屏：更小的 viewBox + 更少的标签，保证文字可读。
 */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const AXIS = '#8A93A6';
const GRID = '#E8EDF5';
const TEXT = '#1D2433';

/** 选取“好看”的坐标轴刻度：约 5 段、步长为 1/2/5/10 的整数倍。 */
function axisScale(maxValue, targetTicks = 5) {
  const raw = Math.max(1, Number(maxValue) || 1);
  const rough = raw / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  if (step < 1) step = 1;
  const max = Math.ceil(raw / step) * step;
  return { max, step };
}

function ticks(max, step) {
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

function fmt(v) {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString();
}

function svgOpen(w, h, label) {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">`;
}

/** 窄屏时把长课程名拆成两行（优先在空格处断开）。 */
function labelLines(label, compact) {
  const s = String(label);
  if (!compact) return [s];
  const chars = Array.from(s);
  if (chars.length <= 9) return [s];
  const space = s.indexOf(' ');
  if (space > 0 && space <= 6) return [s.slice(0, space), s.slice(space + 1)];
  const mid = Math.ceil(chars.length / 2);
  return [chars.slice(0, mid).join(''), chars.slice(mid).join('')];
}

/** 纵向柱状图：适合星期、区间分布等短标签。 */
export function columnChart({
  items,
  max,
  color = '#2F78C4',
  valueFormatter = fmt,
  ariaLabel = '柱状图',
  height = 280,
  compact = false
}) {
  const W = compact ? 360 : 720;
  const H = compact ? 240 : height;
  const pad = compact ? { t: 18, r: 8, b: 38, l: 34 } : { t: 24, r: 18, b: 46, l: 48 };
  const fsAxis = compact ? 9 : 11;
  const fsValue = compact ? 10 : 12;
  const fsLabel = compact ? 10 : 12;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const scale = axisScale(Math.max(1, ...items.map((d) => d.value)));
  const maxV = max ?? scale.max;
  const step = max ? maxV / 5 : scale.step;
  const slot = plotW / Math.max(1, items.length);
  const barW = Math.min(compact ? 30 : 58, slot * 0.52);
  let out = svgOpen(W, H, ariaLabel);
  out += `<title>${esc(ariaLabel)}</title>`;

  for (const v of ticks(maxV, step)) {
    const y = pad.t + plotH - (v / maxV) * plotH;
    out += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${pad.l - 6}" y="${y + 3.5}" text-anchor="end" font-size="${fsAxis}" fill="${AXIS}">${fmt(v)}</text>`;
  }

  items.forEach((d, i) => {
    const x = pad.l + slot * i + (slot - barW) / 2;
    const h = maxV > 0 ? Math.max(0, (d.value / maxV) * plotH) : 0;
    const y = pad.t + plotH - h;
    const fill = d.color || color;
    const display = d.display ?? valueFormatter(d.value);
    out += `<g><title>${esc(d.label)}：${esc(display)}</title>`;
    out += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${fill}" opacity=".92"/>`;
    out += `<text x="${x + barW / 2}" y="${y - 7}" text-anchor="middle" font-size="${fsValue}" font-weight="600" fill="${TEXT}">${esc(
      display
    )}</text>`;
    out += `<text x="${x + barW / 2}" y="${pad.t + plotH + 17}" text-anchor="middle" font-size="${fsLabel}" fill="${AXIS}">${esc(
      d.label
    )}</text>`;
    out += '</g>';
  });

  out += `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="${GRID}" stroke-width="1.5"/>`;
  out += '</svg>';
  return out;
}

/** 横向条形图：适合课程名较长的分类比较。 */
export function hBarChart({
  items,
  max,
  valueFormatter = fmt,
  ariaLabel = '条形图',
  rowHeight,
  showGrid = true,
  compact = false
}) {
  const W = compact ? 360 : 720;
  const row = rowHeight ?? (compact ? 44 : 46);
  const pad = compact ? { t: 14, r: 46, b: 28, l: 104 } : { t: 16, r: 84, b: 30, l: 148 };
  const H = pad.t + items.length * row + pad.b;
  const fsAxis = compact ? 9 : 11;
  const fsLabel = compact ? 10.5 : 12.5;
  const fsValue = compact ? 10.5 : 12;
  const plotW = W - pad.l - pad.r;
  const scale = axisScale(Math.max(1, ...items.map((d) => d.value)));
  const maxV = max ?? scale.max;
  const step = max ? maxV / 5 : scale.step;
  let out = svgOpen(W, H, ariaLabel);
  out += `<title>${esc(ariaLabel)}</title>`;

  if (showGrid) {
    for (const v of ticks(maxV, step)) {
      const x = pad.l + (v / maxV) * plotW;
      out += `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + items.length * row}" stroke="${GRID}" stroke-width="1"/>`;
      out += `<text x="${x}" y="${H - 9}" text-anchor="middle" font-size="${fsAxis}" fill="${AXIS}">${fmt(v)}</text>`;
    }
  }

  items.forEach((d, i) => {
    const cy = pad.t + i * row + row / 2;
    const barH = Math.min(compact ? 18 : 22, row * 0.5);
    const w = maxV > 0 ? Math.max(0, (d.value / maxV) * plotW) : 0;
    const fill = d.color || '#2F78C4';
    const display = d.display ?? valueFormatter(d.value);
    const lines = labelLines(d.label, compact);
    out += `<g><title>${esc(d.label)}：${esc(display)}</title>`;
    if (lines.length === 1) {
      out += `<text x="${pad.l - 9}" y="${cy + 4}" text-anchor="end" font-size="${fsLabel}" fill="${TEXT}">${esc(lines[0])}</text>`;
    } else {
      out += `<text x="${pad.l - 9}" y="${cy - 1}" text-anchor="end" font-size="${fsLabel}" fill="${TEXT}">${esc(lines[0])}</text>`;
      out += `<text x="${pad.l - 9}" y="${cy + 12}" text-anchor="end" font-size="${fsLabel}" fill="${TEXT}">${esc(
        lines[1]
      )}</text>`;
    }
    out += `<rect x="${pad.l}" y="${cy - barH / 2}" width="${plotW}" height="${barH}" rx="4" fill="#F0F3F9"/>`;
    out += `<rect x="${pad.l}" y="${cy - barH / 2}" width="${w}" height="${barH}" rx="4" fill="${fill}" opacity=".92"/>`;
    out += `<text x="${Math.min(W - pad.r + 6, pad.l + w + 9)}" y="${cy + 4}" font-size="${fsValue}" font-weight="600" fill="${TEXT}">${esc(
      display
    )}</text>`;
    out += '</g>';
  });

  out += '</svg>';
  return out;
}

/** 折线图：适合每日趋势。 */
export function lineChart({
  points,
  color = '#2F78C4',
  valueFormatter = fmt,
  ariaLabel = '折线图',
  height = 280,
  compact = false
}) {
  const W = compact ? 360 : 720;
  const H = compact ? 240 : height;
  const pad = compact ? { t: 18, r: 10, b: 36, l: 34 } : { t: 24, r: 22, b: 46, l: 48 };
  const fsAxis = compact ? 9 : 11;
  const fsLabel = compact ? 9.5 : 11;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const scale = axisScale(Math.max(1, ...points.map((p) => p.value)));
  const maxV = scale.max;
  const n = points.length;
  const xAt = (i) => pad.l + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yAt = (v) => pad.t + plotH - (maxV > 0 ? (v / maxV) * plotH : 0);

  let out = svgOpen(W, H, ariaLabel);
  out += `<title>${esc(ariaLabel)}</title>`;

  for (const v of ticks(maxV, scale.step)) {
    const y = pad.t + plotH - (v / maxV) * plotH;
    out += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${pad.l - 6}" y="${y + 3.5}" text-anchor="end" font-size="${fsAxis}" fill="${AXIS}">${fmt(v)}</text>`;
  }

  if (n > 0) {
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(p.value)}`).join(' ');
    const areaPath = `${linePath} L${xAt(n - 1)},${pad.t + plotH} L${xAt(0)},${pad.t + plotH} Z`;
    out += `<path d="${areaPath}" fill="${color}" opacity=".10"/>`;
    out += `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;

    // 均匀取 6（窄屏）/ 8（桌面）个刻度，包含首尾，避免末尾两个日期挤在一起
    const labelCount = Math.min(n, compact ? 6 : 8);
    const labelIdx = new Set();
    for (let k = 0; k < labelCount; k++) {
      labelIdx.add(labelCount <= 1 ? 0 : Math.round((k * (n - 1)) / (labelCount - 1)));
    }
    points.forEach((p, i) => {
      const display = p.display ?? valueFormatter(p.value);
      out += `<g><title>${esc(p.label)}：${esc(display)}</title>`;
      out += `<circle cx="${xAt(i)}" cy="${yAt(p.value)}" r="3.2" fill="#fff" stroke="${color}" stroke-width="2"/>`;
      if (labelIdx.has(i)) {
        out += `<text x="${xAt(i)}" y="${pad.t + plotH + 17}" text-anchor="middle" font-size="${fsLabel}" fill="${AXIS}">${esc(
          p.shortLabel ?? p.label
        )}</text>`;
      }
      out += '</g>';
    });
  }

  out += `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="${GRID}" stroke-width="1.5"/>`;
  out += '</svg>';
  return out;
}