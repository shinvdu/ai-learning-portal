/**
 * Media API (F094/F097). Paths are relative; the app mounts this router under
 * `/api/v1` (and therefore `/api` through the legacy alias):
 *
 * - `POST /admin/media/presign` (admin) `{filename,contentType}` →
 *   `{key,uploadUrl,publicUrl,expiresIn,driver,path}`. S3 returns a presigned
 *   PUT; local returns the admin upload endpoint so the client can POST raw
 *   bytes there.
 * - `POST /admin/media/upload` (admin, raw body, legacy 50 MiB cap) →
 *   `{key,url,driver:'local',path}`. Local only; S3 rejects with a pointer to
 *   presign. The cap is `min(MEDIA_MAX_BYTES, 50 MiB)` so raising the chunked
 *   upload ceiling never lets a single raw request exceed 50 MiB.
 * - Resumable uploads (`/admin/media/uploads*`): create a session, PUT chunks,
 *   resume from `uploadedChunks`, complete (assemble + persist) or abort.
 * - `GET /admin/media` lists stored objects with course/chapter references;
 *   `DELETE /admin/media/:key` refuses referenced objects unless `force=1`.
 * - `POST /admin/media/cleanup` deletes unreferenced objects past the grace
 *   period and expires stale upload sessions.
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
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '@portal/config';
import type { Db } from '@portal/db';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validateBody } from '../../middleware/validate.js';
import { AppError, badRequest, notFound, zodErrorToAppError } from '../../lib/errors.js';
import { auditRequest } from '../audit/service.js';
import { generateMediaKey, isValidMediaKey } from './keys.js';
import { createMediaStorage } from './storage.js';
import {
  addMediaUploadChunk,
  createMediaUpload,
  getMediaUpload,
  listMediaReferences,
  setMediaUploadStatus,
  type MediaUploadRecord,
} from '../../db/repositories/media.js';
import {
  assembleChunks,
  chunkPath,
  effectiveChunkSize,
  isValidUploadId,
  newUploadId,
  purgeExpiredUploads,
  removeSessionDir,
  sessionView,
  totalChunksFor,
  uploadSessionDir,
} from './upload-service.js';
import { cleanupMediaLibrary } from './library-service.js';
import type { MediaRange, MediaStorage } from './types.js';

export const MEDIA_PRESIGN_EXPIRES_IN = 900;
/** Hard ceiling for the legacy single-request raw upload (50 MiB). */
export const LEGACY_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const API_PREFIX = '/api/v1';

/** Effective cap for the legacy single-request raw upload. */
export function legacyUploadCap(env: Pick<Env, 'MEDIA_MAX_BYTES'>): number {
  return Math.min(env.MEDIA_MAX_BYTES, LEGACY_MEDIA_MAX_BYTES);
}

const CONTENT_TYPE_PATTERN = /^[^\s/]+\/[^\s/]+(?:\s*;.*)?$/;

const PresignSchema = z.object({
  filename: z.string().trim().min(1, '文件名不能为空').max(255, '文件名过长'),
  contentType: z
    .string()
    .trim()
    .min(1, 'contentType 不能为空')
    .max(200, 'contentType 过长')
    .regex(CONTENT_TYPE_PATTERN, 'contentType 不合法'),
});

const UploadCreateSchema = z.object({
  filename: z.string().trim().min(1, '文件名不能为空').max(255, '文件名过长'),
  contentType: z
    .string()
    .trim()
    .min(1, 'contentType 不能为空')
    .max(200, 'contentType 过长')
    .regex(CONTENT_TYPE_PATTERN, 'contentType 不合法'),
  totalSize: z
    .number({ error: 'totalSize 必须是数字' })
    .int('totalSize 必须是整数')
    .positive('totalSize 必须大于 0'),
});

const LibraryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const CleanupSchema = z.object({
  dryRun: z.boolean().optional(),
  graceHours: z.number().int().min(0).max(24 * 365).optional(),
});

type PresignInput = z.infer<typeof PresignSchema>;
type UploadCreateInput = z.infer<typeof UploadCreateSchema>;

type MediaContext = { env: Env; storage: MediaStorage; db: Db | undefined };

export type MediaRouterOptions = {
  /** Explicit env (tests); otherwise read from `app.locals.env`. */
  env?: Env;
  /** Explicit storage (tests); otherwise built from env on first use. */
  storage?: MediaStorage;
  /** Explicit database (tests); otherwise read from `app.locals.db`. */
  db?: Db;
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

function parseBooleanFlag(value: unknown): boolean {
  const text = firstString(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
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

/** All uploaded chunk indexes from 0..total-1, each exactly once. */
function hasAllChunks(chunks: number[], totalChunks: number): boolean {
  if (chunks.length !== totalChunks) return false;
  const sorted = [...chunks].sort((a, b) => a - b);
  return sorted.every((value, index) => value === index);
}

function requireOwner(record: MediaUploadRecord, req: Request): void {
  if (record.user_id !== req.user?.id) throw notFound('上传会话不存在');
}

export function createMediaRouter(options: MediaRouterOptions = {}): Router {
  const router = Router();
  const rawParsers = new Map<number, RequestHandler>();
  let cached: { env: Env; storage: MediaStorage } | undefined;

  function context(req: Request): MediaContext {
    const env = options.env ?? (req.app.locals.env as Env | undefined);
    if (!env) throw new AppError(500, '媒体存储未配置');
    const db = options.db ?? (req.app.locals.db as Db | undefined);
    if (options.storage) return { env, storage: options.storage, db };
    if (!cached || cached.env !== env) {
      cached = { env, storage: createMediaStorage(env) };
    }
    return { ...cached, db };
  }

  function requireDb(ctx: MediaContext): Db {
    if (!ctx.db) throw new AppError(500, '媒体上传会话存储未配置');
    return ctx.db;
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

  /** Await the raw body as a promise so async handlers can validate first. */
  function readRawBody(req: Request, res: express.Response, maxBytes: number): Promise<void> {
    return new Promise((resolve, reject) => {
      uploadBody(maxBytes)(req, res, (error?: unknown) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  function uploadRecordParams(req: Request): string {
    const id = String((req.params as Record<string, string | undefined>)['id'] ?? '');
    if (!isValidUploadId(id)) throw notFound('上传会话不存在');
    return id;
  }

  async function loadOwnedUpload(req: Request, db: Db): Promise<MediaUploadRecord> {
    const id = uploadRecordParams(req);
    const record = await getMediaUpload(db, id);
    if (!record) throw notFound('上传会话不存在');
    requireOwner(record, req);
    return record;
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
      // Legacy single-request upload intentionally stays at 50 MiB.
      uploadBody(legacyUploadCap(env))(req, res, next);
    },
    async (req, res) => {
      const { env, storage } = context(req);
      if (storage.driver !== 'local') {
        throw badRequest(
          'S3 模式不支持直传，请使用 POST /api/v1/admin/media/presign 获取预签名上传地址',
        );
      }

      const maxBytes = legacyUploadCap(env);
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body)) {
        throw badRequest('上传内容必须是原始字节流（application/octet-stream）');
      }
      if (body.byteLength === 0) throw badRequest('上传内容为空');
      if (body.byteLength > maxBytes) throw fileTooLarge(maxBytes);

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

  /* --------------------------- resumable uploads --------------------------- */

  router.post(
    '/admin/media/uploads',
    requireAdmin,
    validateBody(UploadCreateSchema),
    async (req, res) => {
      const ctx = context(req);
      const db = requireDb(ctx);
      const user = req.user;
      if (!user) throw new AppError(401, '请先登录');
      const { filename, contentType, totalSize } = req.body as UploadCreateInput;

      if (totalSize > ctx.env.MEDIA_MAX_BYTES) throw fileTooLarge(ctx.env.MEDIA_MAX_BYTES);

      const now = new Date();
      await purgeExpiredUploads(db, ctx.env, now);

      const chunkSize = effectiveChunkSize(ctx.env);
      const totalChunks = totalChunksFor(totalSize, chunkSize);
      const expiresAt = new Date(now.getTime() + ctx.env.MEDIA_UPLOAD_TTL_HOURS * 60 * 60 * 1000);
      const id = newUploadId();
      const key = generateMediaKey(filename);

      const record = await createMediaUpload(db, {
        id,
        userId: user.id,
        filename,
        contentType,
        totalSize,
        chunkSize,
        totalChunks,
        storageDriver: ctx.storage.driver,
        key,
        expiresAt,
      });

      await auditRequest(req, db, 'media.upload_started', {
        targetType: 'media_upload',
        targetId: id,
        details: { key, filename, totalSize, chunkSize, totalChunks, driver: ctx.storage.driver },
      });

      res.status(201).json({
        id: record.id,
        key: record.key,
        chunkSize: record.chunk_size,
        totalChunks: record.total_chunks,
        uploadedChunks: [],
        expiresAt: record.expires_at.toISOString(),
        status: 'uploading',
      });
    },
  );

  router.get('/admin/media/uploads/:id', requireAdmin, async (req, res) => {
    const ctx = context(req);
    const db = requireDb(ctx);
    await purgeExpiredUploads(db, ctx.env);
    const record = await loadOwnedUpload(req, db);
    res.json(sessionView(record));
  });

  router.put('/admin/media/uploads/:id/chunks/:index', requireAdmin, async (req, res) => {
    const ctx = context(req);
    const db = requireDb(ctx);
    const record = await loadOwnedUpload(req, db);
    if (record.status !== 'uploading') {
      throw new AppError(409, '上传会话不在上传中状态');
    }

    const rawIndex = String((req.params as Record<string, string | undefined>)['index'] ?? '');
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= record.total_chunks) {
      throw badRequest('分片序号超出范围');
    }

    await readRawBody(req, res, ctx.env.MEDIA_CHUNK_SIZE);
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body)) {
      throw badRequest('分片内容必须是原始字节流（application/octet-stream）');
    }
    if (body.byteLength === 0) throw badRequest('分片内容为空');
    if (body.byteLength > record.chunk_size) throw fileTooLarge(record.chunk_size);

    const now = new Date();
    if (record.expires_at.getTime() <= now.getTime()) {
      throw new AppError(409, '上传会话已过期');
    }

    const dir = uploadSessionDir(ctx.env, record.id);
    await fs.mkdir(dir, { recursive: true });
    const target = chunkPath(ctx.env, record.id, index);
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, body);
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }

    const updated = await addMediaUploadChunk(db, record.id, index, now);
    if (!updated) throw new AppError(409, '上传会话不在上传中状态');

    res.json({ index, received: body.byteLength, totalChunks: record.total_chunks });
  });

  router.post('/admin/media/uploads/:id/complete', requireAdmin, async (req, res) => {
    const ctx = context(req);
    const db = requireDb(ctx);
    const record = await loadOwnedUpload(req, db);

    if (record.status === 'completed') {
      res.json({
        key: record.key,
        path: mediaPath(record.key),
        driver: ctx.storage.driver,
        size: Number(record.total_size),
      });
      return;
    }
    if (record.status !== 'uploading') {
      throw new AppError(409, '上传会话不在上传中状态');
    }
    const now = new Date();
    if (record.expires_at.getTime() <= now.getTime()) {
      throw new AppError(409, '上传会话已过期');
    }
    if (!hasAllChunks(record.uploaded_chunks, record.total_chunks)) {
      throw badRequest('分片尚未全部上传');
    }

    const dir = uploadSessionDir(ctx.env, record.id);
    const assembled = path.join(dir, 'assembled.part');
    let size: number;
    try {
      size = await assembleChunks(ctx.env, record.id, assembled, record);
    } catch (error) {
      await fs.rm(assembled, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw badRequest(`分片校验失败：${message}`);
    }

    if (size !== Number(record.total_size)) {
      await fs.rm(assembled, { force: true }).catch(() => undefined);
      throw badRequest(`分片总大小不符（期望 ${record.total_size}，实际 ${size}）`);
    }

    try {
      await ctx.storage.putFile(record.key, assembled, record.content_type);
    } catch (error) {
      // Keep the staged chunks so `complete` can be retried.
      await fs.rm(assembled, { force: true }).catch(() => undefined);
      throw error;
    }

    await fs.rm(assembled, { force: true }).catch(() => undefined);
    await removeSessionDir(ctx.env, record.id);
    await setMediaUploadStatus(db, record.id, 'completed', now);

    await auditRequest(req, db, 'media.upload_completed', {
      targetType: 'media_upload',
      targetId: record.id,
      details: { key: record.key, size, driver: ctx.storage.driver },
    });

    res.json({
      key: record.key,
      path: mediaPath(record.key),
      driver: ctx.storage.driver,
      size,
    });
  });

  router.delete('/admin/media/uploads/:id', requireAdmin, async (req, res) => {
    const ctx = context(req);
    const db = requireDb(ctx);
    const record = await loadOwnedUpload(req, db);

    if (record.status === 'completed') {
      throw new AppError(409, '已完成的上传会话不能中止');
    }
    if (record.status !== 'aborted') {
      await setMediaUploadStatus(db, record.id, 'aborted', new Date());
      await removeSessionDir(ctx.env, record.id);
      await auditRequest(req, db, 'media.upload_aborted', {
        targetType: 'media_upload',
        targetId: record.id,
        details: { key: record.key },
      });
    }
    res.json({ ok: true, status: 'aborted' });
  });

  /* ------------------------------ media library ----------------------------- */

  router.get('/admin/media', requireAdmin, async (req, res) => {
    const ctx = context(req);
    const db = requireDb(ctx);
    const query = LibraryQuerySchema.safeParse(req.query);
    if (!query.success) throw zodErrorToAppError(query.error);
    const { limit, offset } = query.data;

    const [objects, references] = await Promise.all([
      ctx.storage.list(),
      listMediaReferences(db),
    ]);
    const sorted = objects.sort((a, b) => {
      const delta = b.lastModified.getTime() - a.lastModified.getTime();
      return delta !== 0 ? delta : a.key.localeCompare(b.key);
    });
    const page = sorted.slice(offset, offset + limit);

    res.json({
      total: sorted.length,
      limit,
      offset,
      items: page.map((object) => ({
        key: object.key,
        path: mediaPath(object.key),
        size: object.size,
        lastModified: object.lastModified.toISOString(),
        contentType: object.contentType,
        references: references.get(object.key) ?? [],
      })),
    });
  });

  router.delete('/admin/media/:key', requireAdmin, async (req, res) => {
    const ctx = context(req);
    const db = requireDb(ctx);
    const key = String((req.params as Record<string, string | undefined>)['key'] ?? '');
    if (!isValidMediaKey(key)) throw notFound('媒体文件不存在');
    const force = parseBooleanFlag(req.query['force']);

    await ctx.storage.stat(key);
    const references = (await listMediaReferences(db)).get(key) ?? [];
    if (references.length > 0 && !force) {
      res.status(409).json({
        error: '媒体仍被课程或章节引用，使用 force=1 强制删除',
        references,
      });
      return;
    }

    await ctx.storage.remove(key);
    await auditRequest(req, db, 'media.deleted', {
      targetType: 'media',
      targetId: key,
      details: { key, forced: force, references },
    });
    res.json({ ok: true, key, references });
  });

  router.post('/admin/media/cleanup', requireAdmin, async (req, res) => {
    const ctx = context(req);
    const db = requireDb(ctx);
    const parsed = CleanupSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw zodErrorToAppError(parsed.error);
    const input = parsed.data;

    const result = await cleanupMediaLibrary({
      env: ctx.env,
      db,
      storage: ctx.storage,
      dryRun: input.dryRun,
      graceHours: input.graceHours,
    });

    await auditRequest(req, db, 'media.cleanup', {
      targetType: 'media',
      details: {
        dryRun: input.dryRun === true,
        graceHours: input.graceHours ?? ctx.env.MEDIA_ORPHAN_GRACE_HOURS,
        deleted: result.deleted,
        skippedReferenced: result.skippedReferenced,
        skippedYoung: result.skippedYoung,
        purgedUploads: result.purgedUploads,
        errors: result.errors.length,
      },
    });

    res.json(result);
  });

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