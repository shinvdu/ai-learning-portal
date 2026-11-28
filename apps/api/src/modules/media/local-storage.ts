/**
 * Local filesystem media driver (F094).
 *
 * Objects live directly under `MEDIA_DIR` (default `./data/media`). A hidden
 * `.meta` directory stores `{contentType}` sidecars; because valid keys must
 * start with an alphanumeric character they can never resolve into `.meta`.
 *
 * The API streams these files with HTTP Range support; there is no presigning
 * for local storage, uploads go through the admin upload endpoint instead.
 */
import { createReadStream, promises as fs, type ReadStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Env } from '@portal/config';
import { notFound } from '../../lib/errors.js';
import { isValidMediaKey } from './keys.js';
import type { LocalMediaStorage, MediaRange, MediaStat, PutResult } from './types.js';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const META_DIR = '.meta';

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

type LocalStorageOptions = { env: Pick<Env, 'MEDIA_DIR' | 'PUBLIC_BASE_URL'> };

function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/+$/, '')}${pathname}`;
}

function guessContentType(key: string): string {
  return MIME_BY_EXTENSION[path.extname(key).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
}

/** Resolve a validated key inside the root; defence in depth against traversal. */
function resolveKey(root: string, key: string): string {
  if (!isValidMediaKey(key)) throw notFound('媒体文件不存在');
  const target = path.resolve(root, key);
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw notFound('媒体文件不存在');
  }
  return target;
}

export function createLocalStorage(options: LocalStorageOptions): LocalMediaStorage {
  const root = path.resolve(options.env.MEDIA_DIR);
  const publicBaseUrl = options.env.PUBLIC_BASE_URL;

  async function stat(key: string): Promise<MediaStat> {
    const file = resolveKey(root, key);
    let info;
    try {
      info = await fs.stat(file);
    } catch {
      throw notFound('媒体文件不存在');
    }
    if (!info.isFile()) throw notFound('媒体文件不存在');

    let contentType = guessContentType(key);
    try {
      const raw = await fs.readFile(path.join(root, META_DIR, `${key}.json`), 'utf8');
      const meta = JSON.parse(raw) as { contentType?: unknown };
      if (typeof meta.contentType === 'string' && meta.contentType.trim() !== '') {
        contentType = meta.contentType;
      }
    } catch {
      // Missing/invalid sidecar: fall back to extension inference.
    }
    return { size: info.size, contentType };
  }

  return {
    driver: 'local',

    async put(key: string, data: Buffer, contentType: string): Promise<PutResult> {
      const file = resolveKey(root, key);
      const metaDir = path.join(root, META_DIR);
      await fs.mkdir(root, { recursive: true });
      await fs.mkdir(metaDir, { recursive: true });

      const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      await fs.writeFile(temp, data);
      await fs.rename(temp, file);
      await fs.writeFile(
        path.join(metaDir, `${key}.json`),
        JSON.stringify({ contentType: contentType || guessContentType(key) }),
        'utf8',
      );
      return { key, size: data.byteLength };
    },

    stat,

    async stream(key: string, range?: MediaRange): Promise<ReadStream> {
      // stat() first so a missing file rejects before headers are sent.
      await stat(key);
      const file = resolveKey(root, key);
      return range
        ? createReadStream(file, { start: range.start, end: range.end })
        : createReadStream(file);
    },

    // Local URLs do not expire, so the shared `expiresIn` argument is unused.
    async publicUrl(key: string): Promise<string> {
      return joinUrl(publicBaseUrl, `/api/v1/media/${key}`);
    },
  };
}