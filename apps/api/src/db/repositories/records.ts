/**
 * Learning-record repository for the admin CRUD surface (F062).
 *
 * Records are stored with a `course_id` foreign key (ADR-007); every read joins
 * the `records_with_course_name` view so the API/CSV contract keeps exposing
 * `course_name`. Listing keeps the v1 ordering
 * (`learning_date DESC, student_id, id`) and filters (`course` exact,
 * `student`/`q` substring), while mutations validate the whole row through
 * `@portal/domain` and bump the dataset metadata in the same transaction.
 */
import { and, asc, count, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import {
  appMeta,
  courses as coursesTable,
  records as recordsTable,
  recordsWithCourseName,
  type Db,
} from '@portal/db';
import { validateRecord, type LearningRecord } from '@portal/domain';
import { setMeta, type MetaExecutor } from '../../seed/flags.js';

/** v1-shaped record row returned by list/read/mutation endpoints. */
export type RecordRow = {
  id: number;
  student_id: string;
  course_name: string;
  learning_date: string;
  learning_minutes: number;
  chapters_done: number;
  total_chapters: number;
  quiz_score: number | null;
  created_at: string;
};

export type RecordFilters = {
  course?: string;
  student?: string;
  q?: string;
  limit: number;
  offset: number;
};

export type RecordPage = {
  total: number;
  limit: number;
  offset: number;
  rows: RecordRow[];
};

export type RecordMutationFailure = {
  ok: false;
  notFound?: boolean;
  errors: string[];
};

export type RecordCreateResult = { ok: true; record: RecordRow } | RecordMutationFailure;
export type RecordUpdateResult = RecordCreateResult;

const VIEW_COLUMNS = {
  id: recordsWithCourseName.id,
  student_id: recordsWithCourseName.student_id,
  course_name: recordsWithCourseName.course_name,
  learning_date: recordsWithCourseName.learning_date,
  learning_minutes: recordsWithCourseName.learning_minutes,
  chapters_done: recordsWithCourseName.chapters_done,
  total_chapters: recordsWithCourseName.total_chapters,
  quiz_score: recordsWithCourseName.quiz_score,
  created_at: recordsWithCourseName.created_at,
} as const;

type RawViewRow = {
  id: number;
  student_id: string;
  course_name: string;
  learning_date: string;
  learning_minutes: number;
  chapters_done: number;
  total_chapters: number;
  quiz_score: number | null;
  created_at: Date;
};

function toRecordRow(row: RawViewRow): RecordRow {
  return {
    id: Number(row.id),
    student_id: row.student_id,
    course_name: row.course_name,
    learning_date: row.learning_date,
    learning_minutes: Number(row.learning_minutes),
    chapters_done: Number(row.chapters_done),
    total_chapters: Number(row.total_chapters),
    quiz_score: row.quiz_score === null || row.quiz_score === undefined ? null : Number(row.quiz_score),
    created_at: row.created_at.toISOString(),
  };
}

/** Map current course names to ids (the API/CSV still speaks `course_name`). */
export async function courseNameMap(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ id: coursesTable.id, name: coursesTable.name }).from(coursesTable);
  return new Map(rows.map((row) => [row.name, row.id]));
}

/** Paginated, filtered listing with the fixed v1 order. */
export async function listRecordsPage(db: Db, filters: RecordFilters): Promise<RecordPage> {
  const clauses: SQL[] = [];
  const course = filters.course ?? '';
  const student = filters.student ?? '';
  const q = filters.q ?? '';
  if (course) clauses.push(eq(recordsWithCourseName.course_name, course));
  if (student) clauses.push(like(recordsWithCourseName.student_id, `%${student}%`));
  if (q) {
    clauses.push(
      or(
        like(recordsWithCourseName.student_id, `%${q}%`),
        like(recordsWithCourseName.course_name, `%${q}%`),
      ) as SQL,
    );
  }
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [totalRow] = await db.select({ value: count() }).from(recordsWithCourseName).where(where);
  const rows = await db
    .select(VIEW_COLUMNS)
    .from(recordsWithCourseName)
    .where(where)
    .orderBy(
      desc(recordsWithCourseName.learning_date),
      asc(recordsWithCourseName.student_id),
      asc(recordsWithCourseName.id),
    )
    .limit(filters.limit)
    .offset(filters.offset);

  return {
    total: Number(totalRow?.value ?? 0),
    limit: filters.limit,
    offset: filters.offset,
    rows: rows.map(toRecordRow),
  };
}

/** One record (joined with its current course name) by id. */
export async function getRecordById(db: Db, id: number): Promise<RecordRow | null> {
  const [row] = await db
    .select(VIEW_COLUMNS)
    .from(recordsWithCourseName)
    .where(eq(recordsWithCourseName.id, id))
    .limit(1);
  return row ? toRecordRow(row) : null;
}

async function bumpManualEdits(executor: MetaExecutor): Promise<void> {
  await executor
    .insert(appMeta)
    .values({ key: 'manual_edits', value: '1' })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: sql`cast(cast(${appMeta.value} as integer) + 1 as text)` },
    });
}

async function writeDatasetTimestamp(executor: MetaExecutor): Promise<void> {
  await setMeta(executor, 'dataset_updated_at', new Date().toISOString());
}

/** Validate a raw record against the live course catalogue. */
function validate(raw: Record<string, unknown>, names: ReadonlySet<string>) {
  return validateRecord(raw, names);
}

function toInsertValues(row: LearningRecord, courseId: string) {
  return {
    student_id: row.student_id,
    course_id: courseId,
    learning_date: row.learning_date,
    learning_minutes: row.learning_minutes,
    chapters_done: row.chapters_done,
    total_chapters: row.total_chapters,
    quiz_score: row.quiz_score,
  };
}

/** Insert one record and bump `manual_edits` / `dataset_updated_at`. */
export async function createRecord(db: Db, raw: Record<string, unknown>): Promise<RecordCreateResult> {
  const names = await courseNameMap(db);
  const validation = validate(raw, new Set(names.keys()));
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const courseId = names.get(validation.row.course_name);
  if (!courseId) return { ok: false, errors: [`未知课程：${validation.row.course_name}`] };

  const record = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(recordsTable)
      .values(toInsertValues(validation.row, courseId))
      .returning({ id: recordsTable.id });
    const id = Number(inserted?.id);
    await bumpManualEdits(tx);
    await writeDatasetTimestamp(tx);
    const [row] = await tx
      .select(VIEW_COLUMNS)
      .from(recordsWithCourseName)
      .where(eq(recordsWithCourseName.id, id))
      .limit(1);
    return row ? toRecordRow(row) : null;
  });

  if (!record) throw new Error('创建记录失败');
  return { ok: true, record };
}

const EDITABLE_FIELDS = [
  'student_id',
  'course_name',
  'learning_date',
  'learning_minutes',
  'chapters_done',
  'total_chapters',
  'quiz_score',
] as const;

/**
 * Patch one record. Any subset is accepted; the merged row is revalidated in
 * full, matching the v1 `updateRecord` behaviour (unknown keys are ignored).
 */
export async function updateRecord(
  db: Db,
  id: number,
  patch: Record<string, unknown>,
): Promise<RecordUpdateResult> {
  const current = await getRecordById(db, id);
  if (!current) return { ok: false, notFound: true, errors: ['记录不存在'] };

  const merged: Record<string, unknown> = { ...current };
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) merged[field] = patch[field];
  }

  const names = await courseNameMap(db);
  const validation = validate(merged, new Set(names.keys()));
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const courseId = names.get(validation.row.course_name);
  if (!courseId) return { ok: false, errors: [`未知课程：${validation.row.course_name}`] };

  const record = await db.transaction(async (tx) => {
    const updated = await tx
      .update(recordsTable)
      .set(toInsertValues(validation.row, courseId))
      .where(eq(recordsTable.id, id))
      .returning({ id: recordsTable.id });
    if (updated.length === 0) return null;
    await bumpManualEdits(tx);
    await writeDatasetTimestamp(tx);
    const [row] = await tx
      .select(VIEW_COLUMNS)
      .from(recordsWithCourseName)
      .where(eq(recordsWithCourseName.id, id))
      .limit(1);
    return row ? toRecordRow(row) : null;
  });

  if (!record) return { ok: false, notFound: true, errors: ['记录不存在'] };
  return { ok: true, record };
}

/** Delete one record and bump the dataset metadata. */
export async function deleteRecord(
  db: Db,
  id: number,
): Promise<{ ok: true } | RecordMutationFailure> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(recordsTable)
      .where(eq(recordsTable.id, id))
      .returning({ id: recordsTable.id });
    if (removed.length === 0) return { ok: false, notFound: true, errors: ['记录不存在'] } as const;
    await bumpManualEdits(tx);
    await writeDatasetTimestamp(tx);
    return { ok: true } as const;
  });
}