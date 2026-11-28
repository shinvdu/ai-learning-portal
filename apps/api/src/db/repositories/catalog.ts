/**
 * Public catalogue repository (F031/F032).
 *
 * Read-only access to the data the public course, chapter and knowledge pages
 * need. Raw `records` rows are only ever consumed as `LearningRecord`s for the
 * `@portal/domain` aggregation functions; they are never returned by a public
 * route.
 *
 * Video resolution follows the explicit v2 three-state model (ADR-008):
 *  - `inherit` → the catalogue content configuration (`@portal/content`),
 *  - `custom`  → the `courses.video` JSONB payload,
 *  - `none`    → `null`.
 */
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import {
  appMeta,
  chapters as chaptersTable,
  courses as coursesTable,
  knowledge as knowledgeTable,
  recordsWithCourseName,
  type Db,
} from '@portal/db';
import { COURSES, DEMO_VIDEO } from '@portal/content';
import type { ChapterRow, CourseVideo, DatasetMeta, KnowledgePayload, VideoMode } from '@portal/contracts';
import type { LearningRecord } from '@portal/domain';
import { resolveSeedCsv } from '../../seed/records.js';

/** A course row with its chapter titles and resolved public video. */
export type CatalogCourse = {
  id: string;
  name: string;
  category: string;
  teacher: string;
  level: string;
  badge: string | null;
  color: string | null;
  intro: string | null;
  sort_order: number;
  chapters: string[];
  video: CourseVideo | null;
  /** Internal state; public v1-compatible responses omit it. */
  video_mode: VideoMode;
};

const CONTENT_BY_ID = new Map(COURSES.map((course) => [course.id, course]));

/**
 * Resolve the public video for a course.
 *
 * `inherit` uses the packaged content configuration (which is the shared demo
 * video) and falls back to `DEMO_VIDEO` for courses the content package does
 * not know about.
 */
export function resolveCourseVideo(
  mode: VideoMode,
  payload: CourseVideo | null,
  courseId: string,
): CourseVideo | null {
  if (mode === 'none') return null;
  if (mode === 'custom') return payload ?? null;
  return CONTENT_BY_ID.get(courseId)?.video ?? DEMO_VIDEO;
}

/**
 * All courses in the v1 order (`sort_order, id_num, id`), each with its chapter
 * titles ordered by `idx`.
 */
export async function listCourses(db: Db): Promise<CatalogCourse[]> {
  const courseRows = await db
    .select({
      id: coursesTable.id,
      name: coursesTable.name,
      category: coursesTable.category,
      teacher: coursesTable.teacher,
      level: coursesTable.level,
      badge: coursesTable.badge,
      color: coursesTable.color,
      intro: coursesTable.intro,
      sort_order: coursesTable.sort_order,
      video_mode: coursesTable.video_mode,
      video: coursesTable.video,
    })
    .from(coursesTable)
    .orderBy(coursesTable.sort_order, coursesTable.id_num, coursesTable.id);

  const chapterRows = await db
    .select({ course_id: chaptersTable.course_id, idx: chaptersTable.idx, title: chaptersTable.title })
    .from(chaptersTable)
    .orderBy(chaptersTable.course_id, chaptersTable.idx);

  const titlesByCourse = new Map<string, string[]>();
  for (const row of chapterRows) {
    const titles = titlesByCourse.get(row.course_id);
    if (titles) titles.push(row.title);
    else titlesByCourse.set(row.course_id, [row.title]);
  }

  return courseRows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    teacher: row.teacher,
    level: row.level,
    badge: row.badge,
    color: row.color,
    intro: row.intro,
    sort_order: row.sort_order,
    chapters: titlesByCourse.get(row.id) ?? [],
    video: resolveCourseVideo(row.video_mode, row.video ?? null, row.id),
    video_mode: row.video_mode,
  }));
}

/** v1 lookup order: exact id first, then exact name. */
export function findCourse(courses: readonly CatalogCourse[], idOrName: string): CatalogCourse | undefined {
  return courses.find((course) => course.id === idOrName) ?? courses.find((course) => course.name === idOrName);
}

/** Chapter rows (`idx, title, body`) for one course, ordered by `idx`. */
export async function listChapterRows(db: Db, courseId: string): Promise<ChapterRow[]> {
  return db
    .select({ idx: chaptersTable.idx, title: chaptersTable.title, body: chaptersTable.body })
    .from(chaptersTable)
    .where(eq(chaptersTable.course_id, courseId))
    .orderBy(chaptersTable.idx);
}

/** One chapter by exact index, or `null` when it does not exist. */
export async function findChapterRow(db: Db, courseId: string, idx: number): Promise<ChapterRow | null> {
  const [chapter] = await db
    .select({ idx: chaptersTable.idx, title: chaptersTable.title, body: chaptersTable.body })
    .from(chaptersTable)
    .where(and(eq(chaptersTable.course_id, courseId), eq(chaptersTable.idx, idx)))
    .limit(1);
  return chapter ?? null;
}

/** Knowledge payload for a course, or `null` when the document is missing. */
export async function getKnowledgePayload(db: Db, courseId: string): Promise<KnowledgePayload | null> {
  const [row] = await db
    .select({ payload: knowledgeTable.payload })
    .from(knowledgeTable)
    .where(eq(knowledgeTable.course_id, courseId))
    .limit(1);
  return (row?.payload as KnowledgePayload | undefined) ?? null;
}

/** Every record joined with its current course name, v1 ordering. */
export async function listRecords(db: Db): Promise<LearningRecord[]> {
  return db
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
    .orderBy(recordsWithCourseName.learning_date, recordsWithCourseName.student_id, recordsWithCourseName.course_name);
}

const DATASET_KEYS = ['dataset_source', 'dataset_updated_at', 'seed_imported_at', 'manual_edits'] as const;

function toManualEdits(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Dataset metadata for `/meta` (v1 `getDatasetMeta`).
 *
 * `seedFile` is the packaged fixture basename, exactly as v1 reported it,
 * independent of which file an import last used.
 */
export async function readDatasetMeta(db: Db): Promise<DatasetMeta> {
  const rows = await db
    .select({ key: appMeta.key, value: appMeta.value })
    .from(appMeta)
    .where(inArray(appMeta.key, [...DATASET_KEYS]));
  const meta = new Map(rows.map((row) => [row.key, row.value]));

  return {
    source: meta.get('dataset_source') ?? '模拟数据',
    seedFile: path.basename(resolveSeedCsv()),
    updatedAt: meta.get('dataset_updated_at') ?? null,
    importedAt: meta.get('seed_imported_at') ?? null,
    manualEdits: toManualEdits(meta.get('manual_edits')),
  };
}