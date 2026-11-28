/**
 * Storage abstraction for course media (F094/F097).
 *
 * Two drivers share the same public surface for serving (`publicUrl`) and for
 * library management (`list`/`stat`/`remove`/`putFile`):
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

/** A stored object as listed by `list()`. */
export type MediaObject = {
  key: string;
  size: number;
  lastModified: Date;
  contentType: string;
};

export type LocalMediaStorage = {
  driver: 'local';
  put(key: string, data: Buffer, contentType: string): Promise<PutResult>;
  /** Copy an existing file into place atomically (used by upload assembly). */
  putFile(key: string, filePath: string, contentType: string): Promise<PutResult>;
  stat(key: string): Promise<MediaStat>;
  stream(key: string, range?: MediaRange): Promise<ReadStream>;
  /** Stored objects only; hidden `.meta`/`.uploads` directories are excluded. */
  list(): Promise<MediaObject[]>;
  /** Remove the object and its metadata sidecar; missing objects are a no-op. */
  remove(key: string): Promise<void>;
  /** Absolute URL the browser can use to fetch the object (API path). */
  publicUrl(key: string, expiresIn: number): Promise<string>;
};

export type S3MediaStorage = {
  driver: 's3';
  presignPut(key: string, contentType: string, expiresIn: number): Promise<string>;
  presignGet(key: string, expiresIn: number): Promise<string>;
  /** Upload a local file with a known `ContentLength` (streamed body). */
  putFile(key: string, filePath: string, contentType: string): Promise<PutResult>;
  stat(key: string): Promise<MediaStat>;
  /** ListObjectsV2 across pages; contentType inferred from the key extension. */
  list(): Promise<MediaObject[]>;
  remove(key: string): Promise<void>;
  /** S3_PUBLIC_URL when configured, otherwise a presigned GET URL. */
  publicUrl(key: string, expiresIn: number): Promise<string>;
};

export type MediaStorage = LocalMediaStorage | S3MediaStorage;