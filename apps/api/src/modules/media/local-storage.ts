/**
 * Local filesystem media driver (F094/F097).
 *
 * Objects live directly under `MEDIA_DIR` (default `./data/media`). Hidden
 * `.meta` directories store `{contentType}` sidecars and `.uploads` holds
 * in-progress chunk staging; because valid keys must start with an
 * alphanumeric character they can never resolve into either directory, and
 * `list()` skips every dot-prefixed entry.
 *
 * The API streams these files with HTTP Range support; there is no presigning
 * for local storage, uploads go through the admin upload endpoints instead.
 */
import { createReadStream, promises as fs, type ReadStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Env } from '@portal/config';
import { notFound } from '../../lib/errors.js';
import { isValidMediaKey } from './keys.js';
import { guessContentType } from './content-types.js';
import type {
  LocalMediaStorage,
  MediaObject,
  MediaRange,
  MediaStat,
  PutResult,
} from './types.js';

const META_DIR = '.meta';
const UPLOAD_DIR = '.uploads';

/** Hidden staging name; `list()` ignores dot-prefixed files by construction. */
function tempName(): string {
  return `.${randomBytes(6).toString('hex')}.tmp`;
}

type LocalStorageOptions = { env: Pick<Env, 'MEDIA_DIR' | 'PUBLIC_BASE_URL'> };

function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/+$/, '')}${pathname}`;
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

  async function readMetaContentType(key: string): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(path.join(root, META_DIR, `${key}.json`), 'utf8');
      const meta = JSON.parse(raw) as { contentType?: unknown };
      if (typeof meta.contentType === 'string' && meta.contentType.trim() !== '') {
        return meta.contentType;
      }
    } catch {
      // Missing/invalid sidecar: fall back to extension inference.
    }
    return undefined;
  }

  async function writeMeta(key: string, contentType: string): Promise<void> {
    const metaDir = path.join(root, META_DIR);
    await fs.mkdir(metaDir, { recursive: true });
    await fs.writeFile(
      path.join(metaDir, `${key}.json`),
      JSON.stringify({ contentType: contentType || guessContentType(key) }),
      'utf8',
    );
  }

  async function stat(key: string): Promise<MediaStat> {
    const file = resolveKey(root, key);
    let info;
    try {
      info = await fs.stat(file);
    } catch {
      throw notFound('媒体文件不存在');
    }
    if (!info.isFile()) throw notFound('媒体文件不存在');
    return { size: info.size, contentType: (await readMetaContentType(key)) ?? guessContentType(key) };
  }

  async function putFile(key: string, filePath: string, contentType: string): Promise<PutResult> {
    const file = resolveKey(root, key);
    await fs.mkdir(root, { recursive: true });
    const info = await fs.stat(filePath);
    if (!info.isFile()) throw new Error(`Not a regular file: ${filePath}`);

    const temp = path.join(root, tempName());
    try {
      await fs.copyFile(filePath, temp);
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    await writeMeta(key, contentType);
    return { key, size: info.size };
  }

  return {
    driver: 'local',

    async put(key: string, data: Buffer, contentType: string): Promise<PutResult> {
      const file = resolveKey(root, key);
      await fs.mkdir(root, { recursive: true });

      const temp = path.join(root, tempName());
      try {
        await fs.writeFile(temp, data);
        await fs.rename(temp, file);
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
      await writeMeta(key, contentType);
      return { key, size: data.byteLength };
    },

    putFile,
    stat,

    async list(): Promise<MediaObject[]> {
      let entries;
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        return [];
      }
      const objects: MediaObject[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith('.')) continue;
        if (!isValidMediaKey(entry.name)) continue;
        try {
          const info = await fs.stat(path.join(root, entry.name));
          objects.push({
            key: entry.name,
            size: info.size,
            lastModified: info.mtime,
            contentType: (await readMetaContentType(entry.name)) ?? guessContentType(entry.name),
          });
        } catch {
          // The object disappeared between readdir and stat: skip it.
        }
      }
      return objects;
    },

    async remove(key: string): Promise<void> {
      const file = resolveKey(root, key);
      await fs.rm(file, { force: true });
      await fs.rm(path.join(root, META_DIR, `${key}.json`), { force: true });
    },

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

/** Reserved staging directory name (exported for the upload service/tests). */
export const LOCAL_UPLOAD_DIR = UPLOAD_DIR;