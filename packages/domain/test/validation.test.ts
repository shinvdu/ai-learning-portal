import { describe, expect, it } from 'vitest';
import { validateRecord } from '../src/index.js';

const courses = new Set(['Python 数据分析', '生成式 AI 基础']);

const validRow = {
  student_id: 'S001',
  course_name: 'Python 数据分析',
  learning_date: '2026-11-04',
  learning_minutes: '60',
  chapters_done: '2',
  total_chapters: '8',
  quiz_score: '',
};

describe('validateRecord', () => {
  it('accepts and normalizes a valid row (blank score becomes null)', () => {
    const result = validateRecord(validRow, courses);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.row).toEqual({
      student_id: 'S001',
      course_name: 'Python 数据分析',
      learning_date: '2026-11-04',
      learning_minutes: 60,
      chapters_done: 2,
      total_chapters: 8,
      quiz_score: null,
    });
  });

  it('keeps quiz_score 0 as a score', () => {
    expect(validateRecord({ ...validRow, quiz_score: '0' }, courses).row.quiz_score).toBe(0);
  });

  it('enforces field rules with v1 messages', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...validRow, student_id: '' }, 'student_id 不能为空'],
      [{ ...validRow, student_id: 'x'.repeat(33) }, 'student_id 过长'],
      [{ ...validRow, course_name: '不存在' }, '未知课程：不存在'],
      [{ ...validRow, learning_date: '2026-02-31' }, 'learning_date 需为有效的 YYYY-MM-DD 日期'],
      [{ ...validRow, learning_minutes: '-1' }, 'learning_minutes 需为 0–1440 的整数'],
      [{ ...validRow, learning_minutes: '1441' }, 'learning_minutes 需为 0–1440 的整数'],
      [{ ...validRow, learning_minutes: '1.5' }, 'learning_minutes 需为 0–1440 的整数'],
      [{ ...validRow, chapters_done: '-1' }, 'chapters_done 需为非负整数'],
      [{ ...validRow, total_chapters: '0' }, 'total_chapters 需为正整数'],
      [{ ...validRow, chapters_done: '9' }, 'chapters_done 不能大于 total_chapters'],
      [{ ...validRow, quiz_score: '101' }, 'quiz_score 需为 0–100 或留空'],
      [{ ...validRow, quiz_score: 'abc' }, 'quiz_score 需为 0–100 或留空'],
    ];
    for (const [row, message] of cases) {
      const result = validateRecord(row, courses);
      expect(result.ok).toBe(false);
      expect(result.errors).toContain(message);
    }
  });
});