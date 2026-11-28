import { isCalendarDate } from './dates.js';
import type { RecordInput, ValidationResult } from './types.js';

/**
 * Validate and normalize one learning record.
 *
 * Rules are a 1:1 port of v1 `validateRow` in `src/db.js`:
 *  - student_id: non-empty, at most 32 chars
 *  - course_name: non-empty and present in `courseNames`
 *  - learning_date: strict real calendar date `YYYY-MM-DD`
 *  - learning_minutes: integer 0–1440
 *  - chapters_done: integer >= 0
 *  - total_chapters: integer > 0
 *  - chapters_done <= total_chapters
 *  - quiz_score: null/blank, or finite number 0–100 (blank is not zero)
 *
 * Error strings and ordering match v1.
 */
export function validateRecord(raw: RecordInput, courseNames: ReadonlySet<string>): ValidationResult {
  const errors: string[] = [];
  const row = {
    student_id: String(raw.student_id ?? '').trim(),
    course_name: String(raw.course_name ?? '').trim(),
    learning_date: String(raw.learning_date ?? '').trim(),
    learning_minutes: Number(raw.learning_minutes),
    chapters_done: Number(raw.chapters_done),
    total_chapters: Number(raw.total_chapters),
    quiz_score:
      raw.quiz_score === null || raw.quiz_score === undefined || String(raw.quiz_score).trim() === ''
        ? null
        : Number(raw.quiz_score),
  };

  if (!row.student_id) errors.push('student_id 不能为空');
  else if (row.student_id.length > 32) errors.push('student_id 过长');

  if (!row.course_name) errors.push('course_name 不能为空');
  else if (!courseNames.has(row.course_name)) errors.push(`未知课程：${row.course_name}`);

  if (!isCalendarDate(row.learning_date)) {
    errors.push('learning_date 需为有效的 YYYY-MM-DD 日期');
  }

  if (!Number.isInteger(row.learning_minutes) || row.learning_minutes < 0 || row.learning_minutes > 1440) {
    errors.push('learning_minutes 需为 0–1440 的整数');
  }
  if (!Number.isInteger(row.chapters_done) || row.chapters_done < 0) {
    errors.push('chapters_done 需为非负整数');
  }
  if (!Number.isInteger(row.total_chapters) || row.total_chapters <= 0) {
    errors.push('total_chapters 需为正整数');
  }
  if (
    Number.isInteger(row.chapters_done) &&
    Number.isInteger(row.total_chapters) &&
    row.chapters_done > row.total_chapters
  ) {
    errors.push('chapters_done 不能大于 total_chapters');
  }
  if (row.quiz_score !== null && (!Number.isFinite(row.quiz_score) || row.quiz_score < 0 || row.quiz_score > 100)) {
    errors.push('quiz_score 需为 0–100 或留空');
  }

  return { ok: errors.length === 0, row, errors };
}