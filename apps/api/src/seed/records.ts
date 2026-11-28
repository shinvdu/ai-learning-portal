/**
 * Demo learning-record seeding from the packaged CSV fixture.
 *
 * Mirrors v1 `resetRecords` / `replaceRecordsFromCsv` (`src/db.js`):
 *  - only import when `records` is empty and demo seeding is allowed;
 *  - validate every row with `@portal/domain` against the live course names;
 *  - translate `course_name` to the `records.course_id` foreign key (ADR-007);
 *  - insert everything and write the dataset metadata in one transaction.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { count } from 'drizzle-orm';
import { courses, records as recordsTable, type Db } from '@portal/db';
import { parseCsv, validateRecord, type LearningRecord } from '@portal/domain';
import { setMeta } from './flags.js';

/** Required CSV columns — identical to the v1 import contract. */
export const REQUIRED_COLUMNS = [
  'student_id',
  'course_name',
  'learning_date',
  'learning_minutes',
  'chapters_done',
  'total_chapters',
] as const;

/** Default fixture path, resolved identically from `src/` and `dist/`. */
export function resolveSeedCsv(): string {
  return (
    process.env.SEED_CSV ??
    fileURLToPath(new URL('../../../../packages/db/fixtures/learning_records.csv', import.meta.url))
  );
}

export type SeedRecordsOptions = {
  /** Demo data is imported only when this is true (production default: false). */
  allowDemo: boolean;
  /** `dataset_source` meta value. */
  source?: string;
  /** Override the fixture path. */
  file?: string;
};

export type SeedRecordsResult = {
  inserted: number;
  /** Rows rejected by validation. */
  skipped: number;
  /** Data rows read from the CSV. */
  total: number;
  errors: string[];
  /** Present when seeding was intentionally skipped. */
  skippedReason?: 'demo-disabled' | 'records-not-empty' | 'no-courses';
  file?: string;
};

type ValidRecord = LearningRecord & { course_id: string };

export async function seedRecords(db: Db, options: SeedRecordsOptions): Promise<SeedRecordsResult> {
  const base: SeedRecordsResult = { inserted: 0, skipped: 0, total: 0, errors: [] };

  if (!options.allowDemo) {
    return { ...base, skippedReason: 'demo-disabled' };
  }

  const [existingRow] = await db.select({ value: count() }).from(recordsTable);
  if (Number(existingRow?.value ?? 0) > 0) {
    return { ...base, skippedReason: 'records-not-empty' };
  }

  const file = options.file ?? resolveSeedCsv();
  const parsed = parseCsv(readFileSync(file, 'utf8'));
  const missing = REQUIRED_COLUMNS.filter((column) => !parsed.headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`种子 CSV 缺少必需列：${missing.join(', ')}`);
  }

  const courseRows = await db.select({ id: courses.id, name: courses.name }).from(courses);
  const courseByName = new Map(courseRows.map((row) => [row.name, row.id]));

  // No catalogue means an administrator deleted every course on purpose. The
  // `catalog_seeded` flag keeps it deleted, so there is nothing to map records
  // onto; skip instead of failing start-up with a wall of unknown-course errors.
  if (courseByName.size === 0) {
    return { ...base, skippedReason: 'no-courses', file };
  }

  const valid: ValidRecord[] = [];
  const errors: string[] = [];
  parsed.rows.forEach((raw, index) => {
    const validation = validateRecord(raw, new Set(courseByName.keys()));
    if (!validation.ok) {
      if (errors.length < 50) errors.push(`第 ${index + 2} 行：${validation.errors.join('；')}`);
      return;
    }
    const courseId = courseByName.get(validation.row.course_name);
    if (!courseId) {
      if (errors.length < 50) errors.push(`第 ${index + 2} 行：未知课程：${validation.row.course_name}`);
      return;
    }
    valid.push({ ...validation.row, course_id: courseId });
  });

  if (valid.length === 0) {
    throw new Error(`种子 CSV 没有有效记录${errors.length ? `：${errors.join('；')}` : ''}`);
  }

  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.insert(recordsTable).values(
      valid.map((row) => ({
        student_id: row.student_id,
        course_id: row.course_id,
        learning_date: row.learning_date,
        learning_minutes: row.learning_minutes,
        chapters_done: row.chapters_done,
        total_chapters: row.total_chapters,
        quiz_score: row.quiz_score,
      })),
    );
    await setMeta(tx, 'dataset_source', options.source ?? 'seed-reset');
    await setMeta(tx, 'dataset_updated_at', now);
    await setMeta(tx, 'seed_file', file);
    await setMeta(tx, 'seed_imported_at', now);
    await setMeta(tx, 'manual_edits', '0');
  });

  return {
    inserted: valid.length,
    skipped: parsed.rows.length - valid.length,
    total: parsed.rows.length,
    errors,
    file,
  };
}