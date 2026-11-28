/**
 * Read-only analytics queries (F033).
 *
 * The repository only fetches raw rows and catalogue metadata; every metric,
 * rounding rule, insight text and chart series is computed by the pure
 * functions in `@portal/domain` (never re-implemented in SQL). Field names
 * mirror v1 so the response shapes stay compatible.
 */
import path from 'node:path';
import { asc, inArray } from 'drizzle-orm';
import { appMeta, courses, recordsWithCourseName, type Db } from '@portal/db';
import type { LearningRecord } from '@portal/domain';
import type { CourseCatalogItem, DatasetMeta } from '@portal/contracts';
import { resolveSeedCsv } from '../../seed/records.js';

/** Course reference used by dashboard filters and colour lookups (v1 shape). */
export type AnalyticsCourse = CourseCatalogItem;

/** Everything the analytics handlers need from PostgreSQL. */
export type AnalyticsSnapshot = {
  records: LearningRecord[];
  courses: AnalyticsCourse[];
  dataset: DatasetMeta;
};

/** Dataset metadata keys written by the seed/import pipeline (v1 `getDatasetMeta`). */
const DATASET_META_KEYS = [
  'dataset_source',
  'dataset_updated_at',
  'seed_imported_at',
  'manual_edits',
] as const;

function toManualEdits(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * All learning records joined with their current course name.
 *
 * Ordering matches v1 `getAllRecords` (`learning_date, student_id,
 * course_name`); metric aggregation is order-independent, but keeping the
 * same order preserves tie-breaking in downstream presentation.
 */
export async function listLearningRecords(db: Db): Promise<LearningRecord[]> {
  const rows = await db
    .select({
      student_id: recordsWithCourseName.student_id,
      course_name: recordsWithCourseName.course_name,
      learning_date: recordsWithCourseName.learning_date,
      learning_minutes: recordsWithCourseName.learning_minutes,
      chapters_done: recordsWithCourseName.chapters_done,
      total_chapters: recordsWithCourseName.total_chapters,
      quiz_score: recordsWithCourseName.quiz_score,
    })
    .from(recordsWithCourseName)
    .orderBy(
      asc(recordsWithCourseName.learning_date),
      asc(recordsWithCourseName.student_id),
      asc(recordsWithCourseName.course_name),
    );

  return rows.map((row) => ({
    ...row,
    quiz_score: row.quiz_score ?? null,
  }));
}

/**
 * Catalogue rows in the v1 display order (`sort_order`, numeric id, id).
 * `id_num` is the generated numeric part of `C{n}` used for stable ordering.
 */
export async function listAnalyticsCourses(db: Db): Promise<AnalyticsCourse[]> {
  return db
    .select({
      id: courses.id,
      name: courses.name,
      color: courses.color,
      badge: courses.badge,
    })
    .from(courses)
    .orderBy(asc(courses.sort_order), asc(courses.id_num), asc(courses.id));
}

/** Dataset provenance metadata embedded in `/dashboard` and `/insights`. */
export async function getDatasetMeta(db: Db): Promise<DatasetMeta> {
  const rows = await db
    .select({ key: appMeta.key, value: appMeta.value })
    .from(appMeta)
    .where(inArray(appMeta.key, [...DATASET_META_KEYS]));
  const meta = new Map(rows.map((row) => [row.key, row.value]));

  return {
    source: meta.get('dataset_source') ?? '模拟数据',
    // v1 reported the packaged fixture basename, not whichever file an import used.
    seedFile: path.basename(resolveSeedCsv()),
    updatedAt: meta.get('dataset_updated_at') ?? null,
    importedAt: meta.get('seed_imported_at') ?? null,
    manualEdits: toManualEdits(meta.get('manual_edits')),
  };
}

/** Fetch records, catalogue and dataset metadata in one call. */
export async function getAnalyticsSnapshot(db: Db): Promise<AnalyticsSnapshot> {
  const [records, courseRows, dataset] = await Promise.all([
    listLearningRecords(db),
    listAnalyticsCourses(db),
    getDatasetMeta(db),
  ]);
  return { records, courses: courseRows, dataset };
}