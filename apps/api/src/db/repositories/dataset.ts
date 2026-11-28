/**
 * Dataset-level record operations (F063/F064): whole-table CSV replacement,
 * dry-run, fixture reset, export, immutable snapshots and snapshot restore.
 *
 * Import semantics stay byte-compatible with v1: parse + validate every row
 * against the live course catalogue, then replace all records in a single
 * transaction. `course_name` is translated to the `records.course_id` foreign
 * key (ADR-007) but the API/CSV contract still speaks `course_name`.
 *
 * F064 adds a safety net for every destructive write:
 *  - the complete pre-change record set is stored in `record_snapshots`
 *    (reason `csv-import` / `seed-reset` / `pre-restore`),
 *  - the import outcome is stored in `dataset_imports` (source = kind,
 *    `details.total` / `details.snapshot_id` carry the fields that have no
 *    dedicated column),
 *  - `restoreSnapshot` re-validates and re-applies a snapshot in one
 *    transaction, snapshotting the current rows first so the restore itself
 *    can be rolled back.
 *
 * The schema has no `actor` column on `record_snapshots`, so the actor email
 * is stored in the `source` text column as JSON metadata
 * (`{datasetSource, actorEmail}`). `snapshots` derives `actor_email` from it.
 */
import { readFileSync } from 'node:fs';
import { desc, eq } from 'drizzle-orm';
import {
  courses as coursesTable,
  datasetImports,
  recordSnapshots,
  records as recordsTable,
  recordsWithCourseName,
  type Db,
} from '@portal/db';
import { parseCsv, toCsv, validateRecord, type LearningRecord } from '@portal/domain';
import { listRecords } from './catalog.js';
import { REQUIRED_COLUMNS, resolveSeedCsv } from '../../seed/records.js';
import { getMeta, setMeta } from '../../seed/flags.js';

export type DatasetOperationResult = {
  ok: boolean;
  inserted: number;
  skipped: number;
  total: number;
  errors: string[];
  /** Snapshot of the pre-import dataset (null for dry-runs and failed parses). */
  snapshotId?: number | null;
  snapshotRowCount?: number | null;
  /** `dataset_imports` row written for this non-dry-run attempt. */
  importId?: number | null;
};

export type ImportOptions = {
  /** `dataset_source` value (v1: `csv-import` / `seed-reset`). */
  source?: string;
  /** Parse and validate only; never touches the database. */
  dryRun?: boolean;
  /** Also write `seed_file` / `seed_imported_at` (used by fixture reset). */
  seedMeta?: boolean;
  /** Snapshot reason; defaults to `seed-reset` for resets, else `csv-import`. */
  snapshotReason?: SnapshotReason;
  /** Administrator email recorded on the snapshot and import row. */
  actorEmail?: string | null;
};

export type SnapshotReason = 'csv-import' | 'seed-reset' | 'pre-restore';

export type SnapshotSummary = {
  id: number;
  created_at: string;
  reason: string;
  row_count: number;
  actor_email: string | null;
};

type ImportRow = LearningRecord & { course_id: string };

/** Columns shared by a pool connection and a Drizzle transaction. */
type DbExecutor = Pick<Db, 'select' | 'insert' | 'delete'>;

type SnapshotSourceMeta = {
  datasetSource: string | null;
  actorEmail: string | null;
};

function encodeSnapshotSource(meta: SnapshotSourceMeta): string {
  return JSON.stringify(meta);
}

function decodeSnapshotSource(source: string | null): SnapshotSourceMeta {
  if (!source) return { datasetSource: null, actorEmail: null };
  try {
    const parsed = JSON.parse(source) as Partial<SnapshotSourceMeta>;
    if (typeof parsed === 'object' && parsed !== null) {
      return {
        datasetSource: typeof parsed.datasetSource === 'string' ? parsed.datasetSource : null,
        actorEmail: typeof parsed.actorEmail === 'string' ? parsed.actorEmail : null,
      };
    }
  } catch {
    /* legacy plain-string source: treat it as the dataset source label */
  }
  return { datasetSource: source, actorEmail: null };
}

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

/** Current records (course names resolved) in v1 export order. */
async function captureRows(client: DbExecutor): Promise<LearningRecord[]> {
  return client
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
      recordsWithCourseName.learning_date,
      recordsWithCourseName.student_id,
      recordsWithCourseName.course_name,
    );
}

function toSummary(row: {
  id: number;
  created_at: Date;
  reason: string;
  source: string | null;
  row_count: number;
}): SnapshotSummary {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    reason: row.reason,
    row_count: row.row_count,
    actor_email: decodeSnapshotSource(row.source).actorEmail,
  };
}

/**
 * Insert an immutable snapshot of the current records. Must run inside the
 * caller's transaction so the captured rows match what is about to change.
 */
async function captureSnapshot(
  client: DbExecutor,
  reason: SnapshotReason,
  actorEmail: string | null | undefined,
): Promise<SnapshotSummary> {
  const rows = await captureRows(client);
  const datasetSource = await getMeta(client, 'dataset_source');
  const [inserted] = await client
    .insert(recordSnapshots)
    .values({
      reason,
      source: encodeSnapshotSource({
        datasetSource,
        actorEmail: actorEmail ?? null,
      }),
      row_count: rows.length,
      rows: rows.map((row) => ({ ...row })),
    })
    .returning({
      id: recordSnapshots.id,
      created_at: recordSnapshots.created_at,
      reason: recordSnapshots.reason,
      source: recordSnapshots.source,
      row_count: recordSnapshots.row_count,
    });
  if (!inserted) throw new Error('record snapshot insert returned no row');
  return toSummary(inserted);
}

/** Record a non-dry-run import attempt (even when it inserted nothing). */
async function recordImport(
  client: DbExecutor,
  input: {
    kind: string;
    inserted: number;
    skipped: number;
    total: number;
    errors: string[];
    snapshotId: number | null;
    actorEmail: string | null | undefined;
  },
): Promise<number | null> {
  const [row] = await client
    .insert(datasetImports)
    .values({
      source: input.kind,
      dry_run: false,
      inserted: input.inserted,
      skipped: input.skipped,
      errors: input.errors.length > 0 ? input.errors : [],
      details: {
        kind: input.kind,
        total: input.total,
        snapshot_id: input.snapshotId,
        actor_email: input.actorEmail ?? null,
      },
    })
    .returning({ id: datasetImports.id });
  return row?.id ?? null;
}

function snapshotReasonFor(options: ImportOptions): SnapshotReason {
  if (options.snapshotReason) return options.snapshotReason;
  return options.source === 'seed-reset' ? 'seed-reset' : 'csv-import';
}

/**
 * Replace every learning record with the valid rows from `csvText`.
 *
 * When no row is valid (or a required column is missing) the database records
 * are left untouched and `ok:false` is returned — v1's "all-invalid import
 * writes nothing" guarantee. A snapshot of the previous rows and a
 * `dataset_imports` row are written for every non-dry-run attempt.
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
  if (!parsed.ok) {
    const importId = await recordImport(db, {
      kind: options.source ?? 'manual-import',
      inserted: 0,
      skipped,
      total: parsed.total,
      errors: parsed.errors,
      snapshotId: null,
      actorEmail: options.actorEmail,
    });
    return { ...base, importId, snapshotId: null, snapshotRowCount: null };
  }

  const source = options.source ?? 'manual-import';
  const reason = snapshotReasonFor(options);
  const now = new Date().toISOString();
  let snapshotId: number | null = null;
  let snapshotRowCount: number | null = null;
  let importId: number | null = null;

  await db.transaction(async (tx) => {
    const snapshot = await captureSnapshot(tx, reason, options.actorEmail);
    snapshotId = snapshot.id;
    snapshotRowCount = snapshot.row_count;

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
    importId = await recordImport(tx, {
      kind: source,
      inserted: parsed.rows.length,
      skipped,
      total: parsed.total,
      errors: parsed.errors,
      snapshotId,
      actorEmail: options.actorEmail,
    });
  });

  return {
    ...base,
    inserted: parsed.rows.length,
    snapshotId,
    snapshotRowCount,
    importId,
  };
}

/** Restore the packaged `learning_records.csv` fixture (F063 reset). */
export async function resetDataset(
  db: Db,
  options: Pick<ImportOptions, 'actorEmail'> = {},
): Promise<DatasetOperationResult> {
  const text = readFileSync(resolveSeedCsv(), 'utf8');
  return importCsv(db, text, {
    source: 'seed-reset',
    seedMeta: true,
    snapshotReason: 'seed-reset',
    actorEmail: options.actorEmail,
  });
}

/** All records in v1 export order, serialised with BOM + CRLF. */
export async function exportCsv(db: Db): Promise<{ csv: string; count: number }> {
  const records = await listRecords(db);
  return { csv: toCsv(records), count: records.length };
}

/* ------------------------------- snapshots ------------------------------- */

/** Snapshot summaries, newest first (rows JSON is deliberately omitted). */
export async function listSnapshots(db: Db): Promise<SnapshotSummary[]> {
  const rows = await db
    .select({
      id: recordSnapshots.id,
      created_at: recordSnapshots.created_at,
      reason: recordSnapshots.reason,
      source: recordSnapshots.source,
      row_count: recordSnapshots.row_count,
    })
    .from(recordSnapshots)
    .orderBy(desc(recordSnapshots.created_at), desc(recordSnapshots.id));
  return rows.map(toSummary);
}

export type RestoreSnapshotResult =
  | {
      ok: true;
      restored: number;
      snapshot: SnapshotSummary;
      preRestoreSnapshot: SnapshotSummary;
    }
  | {
      ok: false;
      status: 'not-found' | 'conflict' | 'invalid';
      errors: string[];
    };

/**
 * Restore one snapshot in a single transaction.
 *
 * Validation happens before any write. Unknown course names are a 409
 * (`conflict`), malformed rows a 400 (`invalid`). The current records are
 * snapshotted as `pre-restore` before they are replaced, so the restore itself
 * can be undone by restoring that snapshot.
 */
export async function restoreSnapshot(
  db: Db,
  snapshotId: number,
  options: { actorEmail?: string | null } = {},
): Promise<RestoreSnapshotResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: recordSnapshots.id,
        created_at: recordSnapshots.created_at,
        reason: recordSnapshots.reason,
        source: recordSnapshots.source,
        row_count: recordSnapshots.row_count,
        rows: recordSnapshots.rows,
      })
      .from(recordSnapshots)
      .where(eq(recordSnapshots.id, snapshotId))
      .limit(1);

    if (!row) return { ok: false, status: 'not-found', errors: ['快照不存在'] } as const;

    const rawRows = row.rows;
    if (!Array.isArray(rawRows) || rawRows.length !== row.row_count) {
      return { ok: false, status: 'invalid', errors: ['快照数据不完整（行数与 row_count 不一致）'] } as const;
    }

    const courseRows = await tx.select({ id: coursesTable.id, name: coursesTable.name }).from(coursesTable);
    const courseByName = new Map(courseRows.map((course) => [course.name, course.id]));
    const courseNames = new Set(courseByName.keys());
    const missingCourses = new Set<string>();
    const errors: string[] = [];
    const valid: ImportRow[] = [];

    rawRows.forEach((raw, index) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        if (errors.length < 50) errors.push(`第 ${index + 1} 行：快照行格式不合法`);
        return;
      }
      const input = raw as Record<string, unknown>;
      const courseName = String(input.course_name ?? '').trim();
      if (!courseNames.has(courseName)) {
        missingCourses.add(courseName || '（空）');
        return;
      }
      const validation = validateRecord(input, courseNames);
      if (!validation.ok) {
        if (errors.length < 50) errors.push(`第 ${index + 1} 行：${validation.errors.join('；')}`);
        return;
      }
      valid.push({ ...validation.row, course_id: courseByName.get(validation.row.course_name)! });
    });

    if (missingCourses.size > 0) {
      return {
        ok: false,
        status: 'conflict',
        errors: [`快照引用的课程不存在：${[...missingCourses].join(', ')}`],
      } as const;
    }
    if (errors.length > 0) {
      return { ok: false, status: 'invalid', errors } as const;
    }

    const preRestoreSnapshot = await captureSnapshot(tx, 'pre-restore', options.actorEmail);
    const now = new Date().toISOString();

    await tx.delete(recordsTable);
    if (valid.length > 0) {
      await tx.insert(recordsTable).values(
        valid.map((record) => ({
          student_id: record.student_id,
          course_id: record.course_id,
          learning_date: record.learning_date,
          learning_minutes: record.learning_minutes,
          chapters_done: record.chapters_done,
          total_chapters: record.total_chapters,
          quiz_score: record.quiz_score,
        })),
      );
    }
    await setMeta(tx, 'dataset_source', 'snapshot-restore');
    await setMeta(tx, 'dataset_updated_at', now);
    await setMeta(tx, 'manual_edits', '0');

    return {
      ok: true,
      restored: valid.length,
      snapshot: toSummary(row),
      preRestoreSnapshot,
    } as const;
  });
}
