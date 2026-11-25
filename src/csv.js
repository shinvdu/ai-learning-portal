/** 轻量 CSV 解析/导出（支持 BOM、引号、逗号与 CRLF，无第三方依赖）。 */

function splitRows(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/** @returns {{headers: string[], rows: Record<string,string>[]}} */
export function parseCsv(text) {
  const raw = splitRows(text);
  if (raw.length === 0) return { headers: [], rows: [] };
  const headers = raw[0].map((h) => h.trim());
  const rows = raw.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows };
}

const COLUMNS = [
  'student_id',
  'course_name',
  'learning_date',
  'learning_minutes',
  'chapters_done',
  'total_chapters',
  'quiz_score'
];

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出带 BOM 的 UTF-8 CSV，方便 Excel 直接打开中文。 */
export function toCsv(records) {
  const lines = [COLUMNS.join(',')];
  for (const r of records) {
    lines.push(COLUMNS.map((c) => csvCell(r[c])).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export { COLUMNS };