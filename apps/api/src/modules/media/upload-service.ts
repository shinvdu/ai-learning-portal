/**
 * Resumable upload helpers (F097).
 *
 * Chunk bytes are staged on the API host (even for the S3 driver) under
 * `MEDIA_DIR/.uploads/<sessionId>/<index>.part`; the final object is only
 * written to the storage driver once `complete` has verified every chunk.
 * `purgeExpiredUploads` is the janitor: it expires stale sessions, drops aged
 * terminal rows and removes orphaned staging directories so temp bytes never
 * grow without bound.
 */
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Env } from '@portal/config';
import type { Db } from '@portal/db';
import {
  deleteStaleMediaUploads,
  listActiveMediaUploadIds,
  listExpiredMediaUploads,
  setMediaUploadStatus,
  type MediaUploadRecord,
} from '../../db/repositories/media.js';

export const UPLOAD_DIR = '.uploads';

const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isValidUploadId(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_ID_PATTERN.test(value);
}

export function newUploadId(): string {
  return randomBytes(18).toString('base64url');
}

export function uploadRoot(env: Pick<Env, 'MEDIA_DIR'>): string {
  return path.resolve(env.MEDIA_DIR, UPLOAD_DIR);
}

export function uploadSessionDir(env: Pick<Env, 'MEDIA_DIR'>, id: string): string {
  if (!isValidUploadId(id)) throw new Error(`Invalid upload id: ${id}`);
  return path.join(uploadRoot(env), id);
}

export function chunkPath(env: Pick<Env, 'MEDIA_DIR'>, id: string, index: number): string {
  return path.join(uploadSessionDir(env, id), `${index}.part`);
}

/** Chunk size actually used; keeps sessions sane when MEDIA_MAX_BYTES is tiny. */
export function effectiveChunkSize(env: Pick<Env, 'MEDIA_CHUNK_SIZE' | 'MEDIA_MAX_BYTES'>): number {
  return Math.min(env.MEDIA_CHUNK_SIZE, env.MEDIA_MAX_BYTES);
}

export function totalChunksFor(totalSize: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(totalSize / chunkSize));
}

/** Expected byte length of one chunk (the last one may be short). */
export function expectedChunkSize(
  index: number,
  totalSize: number,
  chunkSize: number,
  totalChunks: number,
): number {
  return index === totalChunks - 1 ? totalSize - chunkSize * (totalChunks - 1) : chunkSize;
}

export type MediaUploadSessionView = {
  id: string;
  key: string;
  filename: string;
  contentType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  status: MediaUploadRecord['status'];
  expiresAt: string;
};

export function sessionView(record: MediaUploadRecord): MediaUploadSessionView {
  return {
    id: record.id,
    key: record.key,
    filename: record.filename,
    contentType: record.content_type,
    totalSize: Number(record.total_size),
    chunkSize: record.chunk_size,
    totalChunks: record.total_chunks,
    uploadedChunks: [...record.uploaded_chunks].sort((a, b) => a - b),
    status: record.status,
    expiresAt: record.expires_at.toISOString(),
  };
}

/** Remove one session's staged chunks; missing directories are ignored. */
export async function removeSessionDir(
  env: Pick<Env, 'MEDIA_DIR'>,
  id: string,
): Promise<void> {
  if (!isValidUploadId(id)) return;
  await fs.rm(uploadSessionDir(env, id), { recursive: true, force: true });
}

/** Concatenate every chunk into `targetPath` after verifying sizes. */
export async function assembleChunks(
  env: Pick<Env, 'MEDIA_DIR'>,
  id: string,
  targetPath: string,
  record: Pick<MediaUploadRecord, 'total_size' | 'chunk_size' | 'total_chunks'>,
): Promise<number> {
  const handle = await fs.open(targetPath, 'w');
  let written = 0;
  try {
    for (let index = 0; index < record.total_chunks; index += 1) {
      const part = chunkPath(env, id, index);
      const stat = await fs.stat(part);
      const expected = expectedChunkSize(index, record.total_size, record.chunk_size, record.total_chunks);
      if (stat.size !== expected) {
        throw new Error(`分片 ${index} 大小不符（期望 ${expected}，实际 ${stat.size}）`);
      }
      const data = await fs.readFile(part);
      await handle.write(data);
      written += data.byteLength;
    }
  } finally {
    await handle.close();
  }
  return written;
}

export type PurgeResult = {
  expiredSessions: number;
  deletedRows: number;
  removedStagingDirs: number;
};

/**
 * Expire sessions past `MEDIA_UPLOAD_TTL_HOURS`, delete their staged chunks,
 * drop terminal rows older than the TTL and remove orphaned staging dirs.
 * Safe to call on every upload create/status and on cleanup.
 */
export async function purgeExpiredUploads(
  db: Db,
  env: Pick<Env, 'MEDIA_DIR' | 'MEDIA_UPLOAD_TTL_HOURS'>,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const idList: string[] = [];
  const expired = await listExpiredMediaUploads(db, now);
  for (const session of expired) {
    await setMediaUploadStatus(db, session.id, 'expired', now);
    await removeSessionDir(env, session.id);
    idList.push(session.id);
  }

  const ttlMs = env.MEDIA_UPLOAD_TTL_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - ttlMs);
  const deletedRows = await deleteStaleMediaUploads(db, cutoff);

  // Reconcile staging directories: anything not owned by a live session and
  // older than the TTL is leftover from a crash or a deleted row.
  let removedStagingDirs = 0;
  const root = uploadRoot(env);
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const active = new Set(await listActiveMediaUploadIds(db, now));
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidUploadId(entry.name) || active.has(entry.name)) continue;
    try {
      const stat = await fs.stat(path.join(root, entry.name));
      if (stat.mtime.getTime() < cutoff.getTime()) {
        await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
        removedStagingDirs += 1;
      }
    } catch {
      // Directory vanished meanwhile.
    }
  }

  return { expiredSessions: idList.length, deletedRows, removedStagingDirs };
}