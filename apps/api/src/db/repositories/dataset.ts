/**
 * Dataset-level record operations (F063): whole-table CSV replacement,
 * dry-run, fixture reset and export.
 *
 * Import semantics stay byte-compatible with v1: parse + validate every row
 * against the live course catalogue, then replace all records in a single
 * transaction. `course_name` is translated to the `records.course_id` foreign
 * key (ADR-007) but the API/CSV contract still speaks `course_name`.
 *
 * Destructive writes also refresh `dataset_source`, `dataset_updated_at` and
 * `manual_edits` exactly like v1. The fixture reset additionally writes
 * `seed_file` / `seed_imported_at`.
 */
import { readFileSync } from 'node:fs';
import { courses as coursesTable, records as recordsTable, type Db } from '@portal/db';
import { parseCsv, toCsv, validateRecord, type LearningRecord } from '@portal/domain';
import { listRecords } from './catalog.js';
import { REQUIRED_COLUMNS, resolveSeedCsv } from '../../seed/records.js';
import { setMeta } from '../../seed/flags.js';

export type DatasetOperationResult = {
  ok: boolean;
  inserted: number;
  skipped: number;
  total: number;
  errors: string[];
};

export type ImportOptions = {
  /** `dataset_source` value (v1: `csv-import` / `seed-reset`). */
  source?: string;
  /** Parse and validate only; never touches the database. */
  dryRun?: boolean;
  /** Also write `seed_file` / `seed_imported_at` (used by fixture reset). */
  seedMeta?: boolean;
};

type ImportRow = LearningRecord & { course_id: string };

/** Validate a CSV against the current course catalogue without writing. */
async function parseAndValidate(
  db: Db,
  csvText: string,
): Promise<{ rows: ImportRow[]; total: number; errors: string[]; ok: boolean }> {
  const parsed = parseCsv(csvText);
  const missing = REQUIRED_COLUMNS.filter((column) => !parsed.headers.includes(column));
  if (missing.length > 0) {
    return {
      rows: [],
      total: 0,
      errors: [`缺少必需列：${missing.join(', ')}`],
      ok: false,
    };
  }

  const courseRows = await db.select({ id: coursesTable.id, name: coursesTable.name }).from(coursesTable);
  const courseByName = new Map(courseRows.map((row) => [row.name, row.id]));
  const names = new Set(courseByName.keys());

  const rows: ImportRow[] = [];
  const errors: string[] = [];
  parsed.rows.forEach((raw, index) => {
    const validation = validateRecord(raw, names);
    if (!validation.ok) {
      if (errors.length < 50) errors.push(`第 ${index + 2} 行：${validation.errors.join('；')}`);
      return;
    }
    const courseId = courseByName.get(validation.row.course_name);
    if (!courseId) {
      if (errors.length < 50) errors.push(`第 ${index + 2} 行：未知课程：${validation.row.course_name}`);
      return;
    }
    rows.push({ ...validation.row, course_id: courseId });
  });

  return { rows, total: parsed.rows.length, errors, ok: rows.length > 0 };
}

/**
 * Replace every learning record with the valid rows from `csvText`.
 *
 * When no row is valid (or a required column is missing) the database is left
 * untouched and `ok:false` is returned — v1's "all-invalid import writes
 * nothing" guarantee.
 */
export async function importCsv(
  db: Db,
  csvText: string,
  options: ImportOptions = {},
): Promise<DatasetOperationResult> {
  const parsed = await parseAndValidate(db, csvText);
  const skipped = parsed.total - parsed.rows.length;
  const base: DatasetOperationResult = {
    ok: parsed.ok,
    inserted: 0,
    skipped,
    total: parsed.total,
    errors: parsed.errors,
  };

  // Dry-run reports the would-be counts but never writes.
  if (options.dryRun) return { ...base, inserted: parsed.rows.length };
  if (!parsed.ok) return base;

  const source = options.source ?? 'manual-import';
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.delete(recordsTable);
    await tx.insert(recordsTable).values(
      parsed.rows.map((row) => ({
        student_id: row.student_id,
        course_id: row.course_id,
        learning_date: row.learning_date,
        learning_minutes: row.learning_minutes,
        chapters_done: row.chapters_done,
        total_chapters: row.total_chapters,
        quiz_score: row.quiz_score,
      })),
    );
    await setMeta(tx, 'dataset_source', source);
    await setMeta(tx, 'dataset_updated_at', now);
    await setMeta(tx, 'manual_edits', '0');
    if (options.seedMeta) {
      await setMeta(tx, 'seed_file', resolveSeedCsv());
      await setMeta(tx, 'seed_imported_at', now);
    }
  });

  return { ...base, inserted: parsed.rows.length };
}

/** Restore the packaged `learning_records.csv` fixture (F063 reset). */
export async function resetDataset(db: Db): Promise<DatasetOperationResult> {
  const text = readFileSync(resolveSeedCsv(), 'utf8');
  return importCsv(db, text, { source: 'seed-reset', seedMeta: true });
}

/** All records in v1 export order, serialised with BOM + CRLF. */
export async function exportCsv(db: Db): Promise<{ csv: string; count: number }> {
  const records = await listRecords(db);
  return { csv: toCsv(records), count: records.length };
}