/**
 * Content-type inference for media keys (shared by the local and S3 drivers).
 */
import path from 'node:path';

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function guessContentType(key: string): string {
  return MIME_BY_EXTENSION[path.extname(key).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
}