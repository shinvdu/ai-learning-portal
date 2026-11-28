/**
 * Media upload session + library-reference repository (F097).
 *
 * `media_uploads` rows are the source of truth for resumable uploads: chunk
 * bytes live on disk under `MEDIA_DIR/.uploads/<id>`, while this table tracks
 * ownership, the target object key, progress (`uploaded_chunks`) and expiry.
 *
 * `listMediaReferences` scans the JSONB `video` payloads of courses and
 * chapters for `/api/v1/media/<key>` references so deletion and orphan cleanup
 * never break a page that still points at the object.
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  chapters as chaptersTable,
  courses as coursesTable,
  mediaUploads,
  type Db,
  type MediaUploadStatus,
} from '@portal/db';

export type MediaUploadRecord = {
  id: string;
  user_id: number;
  filename: string;
  content_type: string;
  total_size: number;
  chunk_size: number;
  total_chunks: number;
  storage_driver: string;
  status: MediaUploadStatus;
  key: string;
  uploaded_chunks: number[];
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
};

export type CreateMediaUploadInput = {
  id: string;
  userId: number;
  filename: string;
  contentType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  storageDriver: string;
  key: string;
  expiresAt: Date;
};

export type MediaReference = {
  type: 'course' | 'chapter';
  id: string;
  field: 'src' | 'poster';
};

/** `/api/v1/media/<key>` captured from a stored video `src`/`poster`. */
const MEDIA_PATH_PATTERN = /\/api\/v1\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,128})/;

export async function createMediaUpload(
  db: Db,
  input: CreateMediaUploadInput,
): Promise<MediaUploadRecord> {
  const [row] = await db
    .insert(mediaUploads)
    .values({
      id: input.id,
      user_id: input.userId,
      filename: input.filename,
      content_type: input.contentType,
      total_size: input.totalSize,
      chunk_size: input.chunkSize,
      total_chunks: input.totalChunks,
      storage_driver: input.storageDriver,
      status: 'uploading',
      key: input.key,
      uploaded_chunks: [],
      expires_at: input.expiresAt,
    })
    .returning();
  return row as MediaUploadRecord;
}

export async function getMediaUpload(db: Db, id: string): Promise<MediaUploadRecord | null> {
  const [row] = await db.select().from(mediaUploads).where(eq(mediaUploads.id, id)).limit(1);
  return (row as MediaUploadRecord | undefined) ?? null;
}

/**
 * Record a chunk index idempotently in a single statement so parallel chunk
 * PUTs cannot lose each other's progress. Returns the sorted chunk list, or
 * `null` when the session does not exist or is no longer accepting chunks.
 */
export async function addMediaUploadChunk(
  db: Db,
  id: string,
  index: number,
  now: Date,
): Promise<number[] | null> {
  const result = await db.execute(sql`
    update media_uploads
    set uploaded_chunks = (
      select coalesce(jsonb_agg(distinct value::int order by value::int), '[]'::jsonb)
      from jsonb_array_elements_text(uploaded_chunks || ${JSON.stringify([index])}::jsonb) as t(value)
    ),
    updated_at = ${now}
    where id = ${id} and status = 'uploading'
    returning uploaded_chunks
  `);
  const rows = (result as { rows?: Array<{ uploaded_chunks?: unknown }> }).rows ?? [];
  const chunks = rows[0]?.uploaded_chunks;
  return Array.isArray(chunks) ? (chunks as number[]) : null;
}

export async function setMediaUploadStatus(
  db: Db,
  id: string,
  status: MediaUploadStatus,
  now: Date,
): Promise<void> {
  await db
    .update(mediaUploads)
    .set({ status, updated_at: now })
    .where(eq(mediaUploads.id, id));
}

/** Uploading sessions whose TTL has elapsed (chunks must be removed). */
export async function listExpiredMediaUploads(db: Db, now: Date): Promise<MediaUploadRecord[]> {
  return (await db
    .select()
    .from(mediaUploads)
    .where(and(eq(mediaUploads.status, 'uploading'), lte(mediaUploads.expires_at, now)))) as MediaUploadRecord[];
}

/** Ids of sessions still inside their TTL; used to reconcile staging dirs. */
export async function listActiveMediaUploadIds(db: Db, now: Date): Promise<string[]> {
  const rows = await db
    .select({ id: mediaUploads.id })
    .from(mediaUploads)
    .where(and(eq(mediaUploads.status, 'uploading'), sql`${mediaUploads.expires_at} > ${now}`));
  return rows.map((row) => row.id);
}

/** Drop terminal session rows once they have aged past the TTL. */
export async function deleteStaleMediaUploads(db: Db, cutoff: Date): Promise<number> {
  const result = await db
    .delete(mediaUploads)
    .where(
      and(
        inArray(mediaUploads.status, ['completed', 'aborted', 'expired']),
        lte(mediaUploads.updated_at, cutoff),
      ),
    );
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

function addReference(
  map: Map<string, MediaReference[]>,
  value: unknown,
  reference: Omit<MediaReference, 'field'>,
  field: MediaReference['field'],
): void {
  if (typeof value !== 'string') return;
  const match = MEDIA_PATH_PATTERN.exec(value);
  if (!match?.[1]) return;
  const key = match[1];
  const list = map.get(key) ?? [];
  if (!list.some((item) => item.type === reference.type && item.id === reference.id && item.field === field)) {
    list.push({ ...reference, field });
  }
  map.set(key, list);
}

/**
 * Every media key referenced by a course or chapter video payload, keyed by
 * object key. Course chapters are addressed as `<course_id>-<idx>`.
 */
export async function listMediaReferences(db: Db): Promise<Map<string, MediaReference[]>> {
  const map = new Map<string, MediaReference[]>();
  if (!db) return map;

  const courseRows = await db.select({ id: coursesTable.id, video: coursesTable.video }).from(coursesTable);
  for (const row of courseRows) {
    if (!row.video) continue;
    addReference(map, row.video.src, { type: 'course', id: row.id }, 'src');
    addReference(map, row.video.poster, { type: 'course', id: row.id }, 'poster');
  }

  const chapterRows = await db
    .select({
      course_id: chaptersTable.course_id,
      idx: chaptersTable.idx,
      video: chaptersTable.video,
    })
    .from(chaptersTable);
  for (const row of chapterRows) {
    if (!row.video) continue;
    const id = `${row.course_id}-${row.idx}`;
    addReference(map, row.video.src, { type: 'chapter', id }, 'src');
    addReference(map, row.video.poster, { type: 'chapter', id }, 'poster');
  }

  return map;
}