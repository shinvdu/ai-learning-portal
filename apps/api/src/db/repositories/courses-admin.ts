/**
 * Admin course repository (F061).
 *
 * Admin-only catalogue operations: list every course with its stats and
 * chapter bodies, create (ids allocated by `course_seq`, so the next id after
 * `C1–C5` is `C6`), patch metadata/video state, and delete.
 *
 * Renaming never touches `records`: the foreign key is `course_id` and the
 * `records_with_course_name` view resolves the new name (ADR-007). A course
 * with learning records cannot be deleted unless `force` is set; the forced
 * path removes records, chapters, knowledge and the course in one transaction.
 *
 * Video state is explicit (`inherit` | `custom` | `none`) with the database
 * check constraint guaranteeing `custom ⇔ video is not null`.
 */
import { asc, count, eq, max, ne, and } from 'drizzle-orm';
import {
  chapters as chaptersTable,
  courses as coursesTable,
  knowledge as knowledgeTable,
  records as recordsTable,
  type Db,
} from '@portal/db';
import { byCourse, groupEnrollments } from '@portal/domain';
import type { AdminChapterRow, CourseStats, CourseMeta } from '@portal/contracts';
import { resolveCreateVideo, resolveUpdateVideo } from '../../lib/video.js';
import { listRecords, resolveCourseVideo } from './catalog.js';

export type AdminCourse = CourseMeta & {
  stats: CourseStats | null;
  chapterDetails: AdminChapterRow[];
};

export type CourseMutationFailure = {
  ok: false;
  notFound?: boolean;
  conflict?: boolean;
  records?: number;
  errors: string[];
};

export type CourseCreateResult = { ok: true; course: AdminCourse } | CourseMutationFailure;
export type CourseUpdateResult = { ok: true; course: AdminCourse } | CourseMutationFailure;
export type CourseDeleteResult =
  | { ok: true; deletedRecords: number }
  | CourseMutationFailure;

/** Default badge derived from the course name (v1 `COURSE_BADGE`). */
export function courseBadge(name: string): string {
  return (
    String(name)
      .replace(/[^\p{L}\p{N}]/gu, '')
      .slice(0, 2)
      .toUpperCase() || 'AI'
  );
}

type RawCourseRow = typeof coursesTable.$inferSelect;

function toCourseMeta(row: RawCourseRow, chapters: string[]): CourseMeta {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    teacher: row.teacher,
    level: row.level,
    badge: row.badge,
    color: row.color,
    intro: row.intro,
    sort_order: row.sort_order,
    chapters,
    video: resolveCourseVideo(row.video_mode, row.video ?? null, row.id),
    video_mode: row.video_mode,
  };
}

async function readCourseRows(db: Db): Promise<RawCourseRow[]> {
  return db
    .select()
    .from(coursesTable)
    .orderBy(asc(coursesTable.sort_order), asc(coursesTable.id_num), asc(coursesTable.id));
}

async function readChapterDetails(db: Db): Promise<Map<string, AdminChapterRow[]>> {
  const rows = await db
    .select({
      course_id: chaptersTable.course_id,
      idx: chaptersTable.idx,
      title: chaptersTable.title,
      body: chaptersTable.body,
      video_mode: chaptersTable.video_mode,
      video: chaptersTable.video,
    })
    .from(chaptersTable)
    .orderBy(asc(chaptersTable.course_id), asc(chaptersTable.idx));

  const byCourseId = new Map<string, AdminChapterRow[]>();
  for (const row of rows) {
    const list = byCourseId.get(row.course_id);
    const detail: AdminChapterRow = {
      idx: row.idx,
      title: row.title,
      body: row.body,
      video_mode: row.video_mode,
      video: row.video ?? null,
    };
    if (list) list.push(detail);
    else byCourseId.set(row.course_id, [detail]);
  }
  return byCourseId;
}

/** Every course in `sort_order, id_num, id` order with stats + chapter bodies. */
export async function listAdminCourses(db: Db): Promise<AdminCourse[]> {
  const [courseRows, chapterDetails, records] = await Promise.all([
    readCourseRows(db),
    readChapterDetails(db),
    listRecords(db),
  ]);
  const enrollments = groupEnrollments(records);
  const stats = new Map(
    byCourse(records, enrollments, courseRows.map((course) => course.name)).map((entry) => [
      entry.course_name,
      entry,
    ]),
  );

  return courseRows.map((row) => {
    const details = chapterDetails.get(row.id) ?? [];
    return {
      ...toCourseMeta(row, details.map((chapter) => chapter.title)),
      stats: stats.get(row.name) ?? null,
      chapterDetails: details,
    };
  });
}

/** One admin course (meta + stats + chapter bodies), or `null`. */
export async function getAdminCourse(db: Db, id: string): Promise<AdminCourse | null> {
  const courses = await listAdminCourses(db);
  return courses.find((course) => course.id === id) ?? null;
}

async function courseNameTaken(db: Db, name: string, excludeId?: string): Promise<boolean> {
  const where = excludeId
    ? and(eq(coursesTable.name, name), ne(coursesTable.id, excludeId))
    : eq(coursesTable.name, name);
  const [row] = await db.select({ id: coursesTable.id }).from(coursesTable).where(where).limit(1);
  return Boolean(row);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

function trimField(input: Record<string, unknown>, key: string): string {
  return String(input[key] ?? '').trim();
}

const TEXT_LIMITS: Record<string, { max: number; message: string }> = {
  category: { max: 40, message: 'category 过长' },
  teacher: { max: 40, message: 'teacher 过长' },
  level: { max: 40, message: 'level 过长' },
  badge: { max: 8, message: 'badge 过长' },
  intro: { max: 500, message: 'intro 过长' },
};

function readTextFields(
  input: Record<string, unknown>,
  errors: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, rule] of Object.entries(TEXT_LIMITS)) {
    if (input[key] === undefined) continue;
    const value = trimField(input, key);
    if (value.length > rule.max) errors.push(rule.message);
    out[key] = value;
  }
  return out;
}

function readName(input: Record<string, unknown>, errors: string[]): string | undefined {
  if (input.name === undefined) return undefined;
  const name = trimField(input, 'name');
  if (name.length > 80) errors.push('name 过长');
  return name;
}

function readColor(input: Record<string, unknown>, errors: string[]): string | undefined {
  if (input.color === undefined) return undefined;
  // v1: `String(input.color ?? '#2F78C4')` — an explicit null falls back.
  if (input.color === null) return '#2F78C4';
  const color = trimField(input, 'color');
  if (!/^#[0-9a-f]{6}$/i.test(color)) errors.push('color 必须是 #RRGGBB');
  return color;
}

function readSortOrder(input: Record<string, unknown>, errors: string[]): number | undefined {
  if (input.sort_order === undefined) return undefined;
  const value = Number(input.sort_order);
  if (!Number.isInteger(value)) {
    errors.push('sort_order 必须是整数');
    return undefined;
  }
  return value;
}

/** Validate + insert a course; the id comes from the `course_seq` default. */
export async function createCourse(
  db: Db,
  input: Record<string, unknown>,
): Promise<CourseCreateResult> {
  const errors: string[] = [];
  const name = readName(input, errors);
  if (!name) errors.push('name 不能为空');
  const text = readTextFields(input, errors);
  const color = readColor(input, errors);
  const sortOrder = readSortOrder(input, errors);
  const video = resolveCreateVideo(input);

  if (video.errors.length > 0) errors.push(...video.errors);
  if (!name) return { ok: false, errors };
  if (errors.length > 0) return { ok: false, errors };

  if (await courseNameTaken(db, name)) return { ok: false, errors: ['课程名称已存在'] };

  const [maxSortRow] = await db.select({ value: max(coursesTable.sort_order) }).from(coursesTable);
  const nextSort = Number(maxSortRow?.value ?? 0) + 1;

  let id: string;
  try {
    const [inserted] = await db
      .insert(coursesTable)
      .values({
        name,
        category: text.category || '未分类',
        teacher: text.teacher || '待定',
        level: text.level || '入门',
        badge: text.badge || courseBadge(name),
        color: color || '#2F78C4',
        intro: text.intro || '',
        video_mode: video.mode ?? 'none',
        video: video.video ?? null,
        sort_order: sortOrder === undefined ? nextSort : sortOrder,
      })
      .returning({ id: coursesTable.id });
    if (!inserted) throw new Error('创建课程失败');
    id = inserted.id;
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, errors: ['课程名称已存在'] };
    throw error;
  }

  const course = await getAdminCourse(db, id);
  if (!course) throw new Error('创建课程失败');
  return { ok: true, course };
}

/** Patch course metadata / video state. Renaming leaves records untouched. */
export async function updateCourse(
  db: Db,
  id: string,
  patch: Record<string, unknown>,
): Promise<CourseUpdateResult> {
  const [current] = await db.select().from(coursesTable).where(eq(coursesTable.id, id)).limit(1);
  if (!current) return { ok: false, notFound: true, errors: ['课程不存在'] };

  const errors: string[] = [];
  const name = readName(patch, errors);
  const text = readTextFields(patch, errors);
  const color = readColor(patch, errors);
  const sortOrder = readSortOrder(patch, errors);
  const video = resolveUpdateVideo(patch, {
    existingMode: current.video_mode,
    existingVideo: current.video ?? null,
  });
  if (video.errors.length > 0) errors.push(...video.errors);

  const nextName = name ?? current.name;
  if (!nextName) errors.push('课程名称不能为空');
  if (errors.length > 0) return { ok: false, errors };

  if (nextName !== current.name && (await courseNameTaken(db, nextName, id))) {
    return { ok: false, errors: ['课程名称已存在'] };
  }

  const set: Partial<typeof coursesTable.$inferInsert> = {
    name: nextName,
    category: text.category ?? current.category,
    teacher: text.teacher ?? current.teacher,
    level: text.level ?? current.level,
    badge: text.badge ?? current.badge,
    color: color ?? current.color,
    intro: text.intro ?? current.intro,
    sort_order: sortOrder ?? current.sort_order,
  };
  if (video.mode !== undefined) {
    set.video_mode = video.mode;
    set.video = video.video ?? null;
  }

  try {
    // No records update: the FK + view keep historical names resolving.
    await db.update(coursesTable).set(set).where(eq(coursesTable.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, errors: ['课程名称已存在'] };
    throw error;
  }

  const course = await getAdminCourse(db, id);
  if (!course) return { ok: false, notFound: true, errors: ['课程不存在'] };
  return { ok: true, course };
}

/**
 * Delete a course. With records and no `force`, returns a conflict result
 * (409 `{conflict,records}`); forced deletion removes records, chapters,
 * knowledge and the course in a single transaction.
 */
export async function deleteCourse(
  db: Db,
  id: string,
  options: { force?: boolean } = {},
): Promise<CourseDeleteResult> {
  const [current] = await db.select({ id: coursesTable.id }).from(coursesTable).where(eq(coursesTable.id, id)).limit(1);
  if (!current) return { ok: false, notFound: true, errors: ['课程不存在'] };

  const [recordCountRow] = await db
    .select({ value: count() })
    .from(recordsTable)
    .where(eq(recordsTable.course_id, id));
  const recordCount = Number(recordCountRow?.value ?? 0);

  if (recordCount > 0 && !options.force) {
    return {
      ok: false,
      conflict: true,
      records: recordCount,
      errors: [`课程还有 ${recordCount} 条学习记录`],
    };
  }

  await db.transaction(async (tx) => {
    if (options.force) {
      await tx.delete(recordsTable).where(eq(recordsTable.course_id, id));
    }
    await tx.delete(chaptersTable).where(eq(chaptersTable.course_id, id));
    await tx.delete(knowledgeTable).where(eq(knowledgeTable.course_id, id));
    await tx.delete(coursesTable).where(eq(coursesTable.id, id));
  });

  return { ok: true, deletedRecords: recordCount };
}

/** Small helper used by routes that need to know whether a course exists. */
export async function courseExists(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ id: coursesTable.id }).from(coursesTable).where(eq(coursesTable.id, id)).limit(1);
  return Boolean(row);
}

