import { describe, expect, it } from 'vitest';
import { COLUMNS, parseCsv, splitRows, toCsv } from '../src/index.js';
import type { LearningRecord } from '../src/index.js';

const HEADER = 'student_id,course_name,learning_date,learning_minutes,chapters_done,total_chapters,quiz_score';

describe('parseCsv', () => {
  it('handles UTF-8 BOM, CRLF, quoted commas and escaped quotes', () => {
    const text =
      '﻿' +
      HEADER +
      '\r\n' +
      'S001,"课程, 名称",2026-11-04,60,1,8,88\r\n' +
      'S002,"说""明",2026-11-05,0,0,5,\r\n' +
      '\r\n';
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual([...COLUMNS]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.course_name).toBe('课程, 名称');
    expect(rows[1]?.course_name).toBe('说"明');
    expect(rows[1]?.quiz_score).toBe('');
  });

  it('accepts LF-only input and trims header/cell whitespace', () => {
    const text = ` student_id , course_name\nS001, Python 数据分析 \n`;
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(['student_id', 'course_name']);
    expect(rows).toEqual([{ student_id: 'S001', course_name: 'Python 数据分析' }]);
  });

  it('filters blank rows but keeps zero/empty fields', () => {
    const text = `${HEADER}\n\n,,,\nS001,Python 数据分析,2026-11-04,0,0,8,\n`;
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.learning_minutes).toBe('0');
    expect(rows[0]?.quiz_score).toBe('');
  });

  it('returns empty results for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(splitRows('\r\n\r\n')).toEqual([]);
  });
});

describe('toCsv', () => {
  const records: LearningRecord[] = [
    {
      student_id: 'S001',
      course_name: 'Python 数据分析',
      learning_date: '2026-11-04',
      learning_minutes: 60,
      chapters_done: 1,
      total_chapters: 8,
      quiz_score: 88,
    },
    {
      student_id: 'S002',
      course_name: 'A,"B"',
      learning_date: '2026-11-05',
      learning_minutes: 0,
      chapters_done: 0,
      total_chapters: 5,
      quiz_score: null,
    },
  ];

  it('starts with a BOM, uses CRLF and the fixed column order', () => {
    const out = toCsv(records);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.startsWith(`﻿${HEADER}\r\n`)).toBe(true);
    expect(out.endsWith('\r\n')).toBe(true);
    expect(out.split('\r\n')[2]).toBe('S002,"A,""B""",2026-11-05,0,0,5,');
  });

  it('round-trips through parseCsv', () => {
    const { headers, rows } = parseCsv(toCsv(records));
    expect(headers).toEqual([...COLUMNS]);
    expect(rows[0]).toEqual({
      student_id: 'S001',
      course_name: 'Python 数据分析',
      learning_date: '2026-11-04',
      learning_minutes: '60',
      chapters_done: '1',
      total_chapters: '8',
      quiz_score: '88',
    });
    expect(rows[1]?.course_name).toBe('A,"B"');
    expect(rows[1]?.quiz_score).toBe('');
  });

  it('quotes fields containing CR or LF', () => {
    const out = toCsv([{ ...records[0]!, course_name: 'line1\nline2' }]);
    expect(out).toContain('"line1\nline2"');
  });
});