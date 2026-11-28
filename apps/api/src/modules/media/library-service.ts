/**
 * Media library maintenance (F097): orphan detection and cleanup.
 *
 * An object is referenced when a course/chapter `video.src` or `video.poster`
 * contains `/api/v1/media/<key>`. Cleanup never touches referenced objects and
 * never looks inside `.uploads`, so in-progress chunks are always safe.
 */
import type { Env } from '@portal/config';
import type { Db } from '@portal/db';
import { listExpiredMediaUploads, listMediaReferences } from '../../db/repositories/media.js';
import { purgeExpiredUploads } from './upload-service.js';
import type { MediaStorage } from './types.js';

export type CleanupItem = {
  key: string;
  size: number;
  lastModified: string;
  reason: 'orphan' | 'expired-upload';
};

export type CleanupError = { key: string; error: string };

export type CleanupResult = {
  deleted: number;
  skippedReferenced: number;
  skippedYoung: number;
  errors: CleanupError[];
  purgedUploads: number;
  items: CleanupItem[];
};

export type CleanupOptions = {
  env: Pick<Env, 'MEDIA_DIR' | 'MEDIA_ORPHAN_GRACE_HOURS' | 'MEDIA_UPLOAD_TTL_HOURS'>;
  db: Db;
  storage: MediaStorage;
  dryRun?: boolean;
  graceHours?: number;
  now?: Date;
};

export async function cleanupMediaLibrary(options: CleanupOptions): Promise<CleanupResult> {
  const now = options.now ?? new Date();
  const graceHours = options.graceHours ?? options.env.MEDIA_ORPHAN_GRACE_HOURS;
  const cutoff = now.getTime() - graceHours * 60 * 60 * 1000;
  const dryRun = options.dryRun === true;

  const result: CleanupResult = {
    deleted: 0,
    skippedReferenced: 0,
    skippedYoung: 0,
    errors: [],
    purgedUploads: 0,
    items: [],
  };

  if (dryRun) {
    result.purgedUploads = (await listExpiredMediaUploads(options.db, now)).length;
  } else {
    const purge = await purgeExpiredUploads(options.db, options.env, now);
    result.purgedUploads = purge.expiredSessions;
  }

  const references = await listMediaReferences(options.db);
  const objects = await options.storage.list();

  for (const object of objects) {
    if (references.has(object.key)) {
      result.skippedReferenced += 1;
      continue;
    }
    if (object.lastModified.getTime() > cutoff) {
      result.skippedYoung += 1;
      continue;
    }
    const item: CleanupItem = {
      key: object.key,
      size: object.size,
      lastModified: object.lastModified.toISOString(),
      reason: 'orphan',
    };
    if (dryRun) {
      result.items.push(item);
      continue;
    }
    try {
      await options.storage.remove(object.key);
      result.deleted += 1;
      result.items.push(item);
    } catch (error) {
      result.errors.push({
        key: object.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}