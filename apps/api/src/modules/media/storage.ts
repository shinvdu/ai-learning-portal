/**
 * Driver selection for media storage (F094): `STORAGE_DRIVER=local|s3`.
 */
import type { Env } from '@portal/config';
import { createLocalStorage } from './local-storage.js';
import { createS3Storage, type S3ClientLike, type S3Presigner } from './s3-storage.js';
import type { MediaStorage } from './types.js';

export type MediaStorageOverrides = {
  s3Client?: S3ClientLike;
  s3Presigner?: S3Presigner;
};

export function createMediaStorage(
  env: Env,
  overrides: MediaStorageOverrides = {},
): MediaStorage {
  if (env.STORAGE_DRIVER === 's3') {
    return createS3Storage({
      env,
      client: overrides.s3Client,
      presign: overrides.s3Presigner,
    });
  }
  return createLocalStorage({ env });
}