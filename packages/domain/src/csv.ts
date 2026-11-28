/**
 * Lightweight CSV parser/exporter (BOM, quotes, commas, CRLF/LF).
 *
 * Behaviour, output bytes and column order match the v1 implementation in
 * `src/csv.js` exactly: UTF-8 BOM prefix, CRLF line endings, quoted fields
 * only when they contain a comma, quote, CR or LF, and doubled quotes inside
 * quoted fields.
 */

import type { CsvRow, LearningRecord, ParsedCsv } from './types.js';

/** Split raw text into rows of raw cells, honoring quotes and blank-row filtering. */
export function splitRows(text: string): string[][] {
  const src = String(text).replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
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
      if (ch === '\r' && src.charAt(i + 1) === '\n') i += 1;
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
  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
}

/** Parse CSV text into trimmed headers and header-keyed row objects. */
export function parseCsv(text: string): ParsedCsv {
  const raw = splitRows(text);
  const first = raw[0];
  if (!first) return { headers: [], rows: [] };
  const headers = first.map((h) => h.trim());
  const rows = raw.slice(1).map((cells) => {
    const obj: CsvRow = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows };
}

/** Fixed export column order (must stay in sync with the import contract). */
export const COLUMNS = [
  'student_id',
  'course_name',
  'learning_date',
  'learning_minutes',
  'chapters_done',
  'total_chapters',
  'quiz_score',
] as const;

export type CsvColumn = (typeof COLUMNS)[number];

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export records as UTF-8 CSV with BOM + CRLF so Excel opens Chinese correctly. */
export function toCsv(records: readonly LearningRecord[]): string {
  const lines = [COLUMNS.join(',')];
  for (const record of records) {
    lines.push(COLUMNS.map((column) => csvCell(record[column])).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}