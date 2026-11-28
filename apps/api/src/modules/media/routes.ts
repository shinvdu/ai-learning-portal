/**
 * Media API (F094). Paths are relative; the app mounts this router under
 * `/api/v1` (and therefore `/api` through the legacy alias):
 *
 * - `POST /admin/media/presign` (admin) `{filename,contentType}` →
 *   `{key,uploadUrl,publicUrl,expiresIn,driver,path}`. S3 returns a presigned
 *   PUT; local returns the admin upload endpoint so the client can POST raw
 *   bytes there.
 * - `POST /admin/media/upload` (admin, raw body, `MEDIA_MAX_BYTES` cap) →
 *   `{key,url,driver:'local',path}`. Local only; S3 rejects with a pointer to
 *   presign.
 *
 * `path` is the permanent site-local URL (`/api/v1/media/<key>`) that course
 * and chapter video fields must persist; `publicUrl`/`url` may be absolute and
 * (for S3 presigned GETs) expire.
 * - `GET /media/:key` (public) → local stream with single-range 206/416, or a
 *   302 redirect to a presigned S3 GET.
 *
 * Keys are validated against `[A-Za-z0-9][A-Za-z0-9._-]{0,128}`; anything else
 * (traversal, nested paths, hidden files) is a 404.
 */
import express, { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Env } from '@portal/config';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validateBody } from '../../middleware/validate.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { generateMediaKey, isValidMediaKey } from './keys.js';
import { createMediaStorage } from './storage.js';
import type { MediaRange, MediaStorage } from './types.js';

export const MEDIA_PRESIGN_EXPIRES_IN = 900;
const API_PREFIX = '/api/v1';

const PresignSchema = z.object({
  filename: z.string().trim().min(1, '文件名不能为空').max(255, '文件名过长'),
  contentType: z
    .string()
    .trim()
    .min(1, 'contentType 不能为空')
    .max(200, 'contentType 过长')
    .regex(/^[^\s/]+\/[^\s/]+(?:\s*;.*)?$/, 'contentType 不合法'),
});

type PresignInput = z.infer<typeof PresignSchema>;

export type MediaRouterOptions = {
  /** Explicit env (tests); otherwise read from `app.locals.env`. */
  env?: Env;
  /** Explicit storage (tests); otherwise built from env on first use. */
  storage?: MediaStorage;
};

function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/+$/, '')}${pathname}`;
}

function apiUrl(env: Env, pathname: string): string {
  return joinUrl(env.PUBLIC_BASE_URL, `${API_PREFIX}${pathname}`);
}

/** Permanent site-local media path (never absolute, never expiring). */
function mediaPath(key: string): string {
  return `${API_PREFIX}/media/${key}`;
}

function firstString(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' ? candidate : '';
}

function fileTooLarge(maxBytes: number): AppError {
  return new AppError(413, `文件超过 ${maxBytes} 字节限制`);
}

/**
 * Parse a single HTTP Range header. Returns `null` when absent (serve the
 * whole file), `'invalid'` for unsatisfiable/malformed/multi-range requests.
 */
export function parseRangeHeader(
  value: string | undefined,
  size: number,
): MediaRange | null | 'invalid' {
  if (value === undefined || value.trim() === '') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return 'invalid';

  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (rawStart === '' && rawEnd === '') return 'invalid';

  let start: number;
  let end: number;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'invalid';
    if (start >= size || start > end) return 'invalid';
    if (end >= size) end = size - 1;
  }
  if (start < 0 || start > end || size === 0) return 'invalid';
  return { start, end };
}

export function createMediaRouter(options: MediaRouterOptions = {}): Router {
  const router = Router();
  const rawParsers = new Map<number, RequestHandler>();
  let cached: { env: Env; storage: MediaStorage } | undefined;

  function context(req: Request): { env: Env; storage: MediaStorage } {
    const env = options.env ?? (req.app.locals.env as Env | undefined);
    if (!env) throw new AppError(500, '媒体存储未配置');
    if (options.storage) return { env, storage: options.storage };
    if (!cached || cached.env !== env) {
      cached = { env, storage: createMediaStorage(env) };
    }
    return cached;
  }

  function rawParser(maxBytes: number): RequestHandler {
    let parser = rawParsers.get(maxBytes);
    if (!parser) {
      parser = express.raw({ type: () => true, limit: maxBytes });
      rawParsers.set(maxBytes, parser);
    }
    return parser;
  }

  /** Parse a raw upload body, mapping the size cap to a media-specific 413. */
  function uploadBody(maxBytes: number): RequestHandler {
    return (req, res, next) => {
      const declared = Number(req.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > maxBytes) {
        next(fileTooLarge(maxBytes));
        return;
      }
      rawParser(maxBytes)(req, res, (error?: unknown) => {
        if (!error) {
          next();
          return;
        }
        const type = (error as { type?: unknown }).type;
        const status =
          (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
        if (type === 'entity.too.large' || status === 413) {
          next(fileTooLarge(maxBytes));
          return;
        }
        next(error);
      });
    };
  }

  /* ------------------------------- presign -------------------------------- */

  router.post(
    '/admin/media/presign',
    requireAdmin,
    validateBody(PresignSchema),
    async (req, res) => {
      const { env, storage } = context(req);
      const { filename, contentType } = req.body as PresignInput;
      const key = generateMediaKey(filename);
      const expiresIn = MEDIA_PRESIGN_EXPIRES_IN;

      const uploadUrl =
        storage.driver === 's3'
          ? await storage.presignPut(key, contentType, expiresIn)
          : `${apiUrl(env, '/admin/media/upload')}?key=${encodeURIComponent(key)}`;

      const publicUrl = await storage.publicUrl(key, expiresIn);
      res.json({
        key,
        uploadUrl,
        publicUrl,
        expiresIn,
        driver: storage.driver,
        path: mediaPath(key),
      });
    },
  );

  /* -------------------------------- upload -------------------------------- */

  router.post(
    '/admin/media/upload',
    requireAdmin,
    (req, res, next) => {
      const { env } = context(req);
      uploadBody(env.MEDIA_MAX_BYTES)(req, res, next);
    },
    async (req, res) => {
      const { env, storage } = context(req);
      if (storage.driver !== 'local') {
        throw badRequest(
          'S3 模式不支持直传，请使用 POST /api/v1/admin/media/presign 获取预签名上传地址',
        );
      }

      const body: unknown = req.body;
      if (!Buffer.isBuffer(body)) {
        throw badRequest('上传内容必须是原始字节流（application/octet-stream）');
      }
      if (body.byteLength === 0) throw badRequest('上传内容为空');
      if (body.byteLength > env.MEDIA_MAX_BYTES) throw fileTooLarge(env.MEDIA_MAX_BYTES);

      const providedKey = firstString(req.query['key']);
      if (providedKey && !isValidMediaKey(providedKey)) throw badRequest('媒体 key 不合法');
      const key = providedKey || generateMediaKey(firstString(req.query['filename']));

      const contentType = (req.get('content-type') ?? 'application/octet-stream')
        .trim()
        .slice(0, 200);
      await storage.put(key, body, contentType || 'application/octet-stream');
      const url = await storage.publicUrl(key, MEDIA_PRESIGN_EXPIRES_IN);
      res.status(201).json({ key, url, driver: 'local', path: mediaPath(key) });
    },
  );

  /* --------------------------------- serve -------------------------------- */

  router.get('/media/:key', async (req, res) => {
    const { storage } = context(req);
    const key = String((req.params as Record<string, string | undefined>)['key'] ?? '');
    if (!isValidMediaKey(key)) throw notFound('媒体文件不存在');

    if (storage.driver === 's3') {
      const location = await storage.presignGet(key, MEDIA_PRESIGN_EXPIRES_IN);
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, location);
      return;
    }

    const stat = await storage.stat(key);
    const range = parseRangeHeader(req.get('range'), stat.size);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', stat.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');

    if (range === 'invalid') {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.end();
      return;
    }

    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(stat.size));
    }

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = await storage.stream(key, range ?? undefined);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  return router;
}

/** Router wired to the app's `app.locals.env` (mounted by `createApp`). */
export const mediaRouter = createMediaRouter();