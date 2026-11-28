/**
 * Storage abstraction for course media (F094).
 *
 * Two drivers share the same public surface for serving (`publicUrl`):
 *  - `local` keeps bytes on disk under `MEDIA_DIR` and streams them with Range
 *    support through the API.
 *  - `s3` talks to S3/MinIO and serves via presigned GET redirects.
 *
 * Routes only ever depend on `MediaStorage`; tests inject fakes instead of
 * touching a real bucket.
 */
import type { ReadStream } from 'node:fs';

export type MediaRange = { start: number; end: number };

export type MediaStat = { size: number; contentType: string };

export type PutResult = { key: string; size: number };

export type LocalMediaStorage = {
  driver: 'local';
  put(key: string, data: Buffer, contentType: string): Promise<PutResult>;
  stat(key: string): Promise<MediaStat>;
  stream(key: string, range?: MediaRange): Promise<ReadStream>;
  /** Absolute URL the browser can use to fetch the object (API path). */
  publicUrl(key: string, expiresIn: number): Promise<string>;
};

export type S3MediaStorage = {
  driver: 's3';
  presignPut(key: string, contentType: string, expiresIn: number): Promise<string>;
  presignGet(key: string, expiresIn: number): Promise<string>;
  /** S3_PUBLIC_URL when configured, otherwise a presigned GET URL. */
  publicUrl(key: string, expiresIn: number): Promise<string>;
};

export type MediaStorage = LocalMediaStorage | S3MediaStorage;