/**
 * Media (F094) unit tests: local roundtrip/upload/Range, S3 presign with an
 * injected signer, auth gating and key validation.
 *
 * No PostgreSQL/Redis is touched: a tiny Express app mounts the media router
 * with an `x-test-role` header standing in for session resolution.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { Env } from '@portal/config';
import { loadConfig } from '../../src/config.js';
import type { AuthUser } from '../../src/lib/types.js';
import { createLogger } from '../../src/lib/logger.js';
import { createErrorHandler } from '../../src/middleware/error-handler.js';
import {
  createMediaRouter,
  LEGACY_MEDIA_MAX_BYTES,
  MEDIA_PRESIGN_EXPIRES_IN,
  legacyUploadCap,
} from '../../src/modules/media/routes.js';
import { MEDIA_KEY_PATTERN } from '../../src/modules/media/keys.js';
import { createLocalStorage } from '../../src/modules/media/local-storage.js';
import { createS3Storage } from '../../src/modules/media/s3-storage.js';
import type { MediaStorage } from '../../src/modules/media/types.js';

const createdDirs: string[] = [];

const ADMIN: AuthUser = {
  id: 1,
  email: 'admin@portal.test',
  name: 'Admin',
  role: 'admin',
  emailVerified: true,
  mfaEnabled: false,
};

const LEARNER: AuthUser = { ...ADMIN, id: 2, email: 'learner@portal.test', role: 'learner' };

function makeEnv(overrides: Record<string, string> = {}): Env {
  return loadConfig({
    APP_ENV: 'test',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PUBLIC_BASE_URL: 'http://portal.test',
    ...overrides,
  });
}

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-media-'));
  createdDirs.push(dir);
  return dir;
}

/** Minimal app: role comes from `x-test-role`, otherwise anonymous. */
function buildApp(env: Env, storage: MediaStorage): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header('x-test-role');
    req.user = role === 'admin' ? ADMIN : role === 'learner' ? LEARNER : null;
    next();
  });
  app.use(createMediaRouter({ env, storage }));
  app.use(createErrorHandler(createLogger(env)));
  return app;
}

afterAll(async () => {
  await Promise.all(
    createdDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe('local media driver', () => {
  async function setup() {
    const dir = await tempDir();
    const env = makeEnv({ MEDIA_DIR: dir });
    const storage = createLocalStorage({ env });
    const app = buildApp(env, storage);
    return { dir, env, storage, app };
  }

  it('uploads raw bytes and serves them back with metadata', async () => {
    const { app } = await setup();
    const payload = Buffer.from('hello-range!');

    const upload = await request(app)
      .post('/admin/media/upload')
      .set('x-test-role', 'admin')
      .set('Content-Type', 'text/plain; charset=utf-8')
      .send(payload);

    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    const key = String(upload.body.key);
    expect(key).toMatch(MEDIA_KEY_PATTERN);
    expect(upload.body.url).toBe(`http://portal.test/api/v1/media/${key}`);
    expect(upload.body.driver).toBe('local');
    expect(upload.body.path).toBe(`/api/v1/media/${key}`);

    const served = await request(app).get(`/media/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('text/plain');
    expect(served.headers['accept-ranges']).toBe('bytes');
    expect(served.text).toBe('hello-range!');
  });

  it('returns 206 for a single byte range and 416 for invalid ranges', async () => {
    const { app } = await setup();
    const payload = Buffer.from('hello-range!');
    const upload = await request(app)
      .post('/admin/media/upload')
      .set('x-test-role', 'admin')
      .set('Content-Type', 'text/plain; charset=utf-8')
      .send(payload);
    const key = String(upload.body.key);

    const partial = await request(app).get(`/media/${key}`).set('Range', 'bytes=0-4');
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe('bytes 0-4/12');
    expect(partial.headers['content-length']).toBe('5');
    expect(partial.text).toBe('hello');

    const suffix = await request(app).get(`/media/${key}`).set('Range', 'bytes=-4');
    expect(suffix.status).toBe(206);
    expect(suffix.headers['content-range']).toBe('bytes 8-11/12');
    expect(suffix.text).toBe('nge!');

    const pastEnd = await request(app).get(`/media/${key}`).set('Range', 'bytes=99-');
    expect(pastEnd.status).toBe(416);
    expect(pastEnd.headers['content-range']).toBe('bytes */12');

    const multi = await request(app).get(`/media/${key}`).set('Range', 'bytes=0-1,3-4');
    expect(multi.status).toBe(416);
  });

  it('supports HEAD without a body', async () => {
    const { app } = await setup();
    const upload = await request(app)
      .post('/admin/media/upload')
      .set('x-test-role', 'admin')
      .set('Content-Type', 'text/plain; charset=utf-8')
      .send(Buffer.from('abcdef'));
    const key = String(upload.body.key);

    const head = await request(app).head(`/media/${key}`);
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe('6');
    expect(head.text ?? '').toBe('');
  });

  it('enforces the legacy raw-upload cap', async () => {
    const dir = await tempDir();
    const env = makeEnv({ MEDIA_DIR: dir, MEDIA_MAX_BYTES: '8' });
    const app = buildApp(env, createLocalStorage({ env }));

    const tooBig = await request(app)
      .post('/admin/media/upload')
      .set('x-test-role', 'admin')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(9, 1));
    expect(tooBig.status).toBe(413);

    const ok = await request(app)
      .post('/admin/media/upload')
      .set('x-test-role', 'admin')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(8, 1));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

it('putFile/list/remove manage objects and hide meta/staging directories', async () => {
    const dir = await tempDir();
    const sourceDir = await tempDir();
    const env = makeEnv({ MEDIA_DIR: dir });
    const storage = createLocalStorage({ env });

    const source = path.join(sourceDir, 'source.bin');
    await fs.writeFile(source, Buffer.from('file-copy'));
    const put = await storage.putFile('copy.mp4', source, 'video/mp4');
    expect(put).toEqual({ key: 'copy.mp4', size: 9 });

    await storage.put('direct.png', Buffer.from('png'), '');
    await fs.mkdir(path.join(dir, '.uploads', 'session'), { recursive: true });
    await fs.writeFile(path.join(dir, '.uploads', 'session', '0.part'), 'x');

    const objects = await storage.list();
    expect(objects.map((object) => object.key).sort()).toEqual(['copy.mp4', 'direct.png']);
    const copied = objects.find((object) => object.key === 'copy.mp4');
    expect(copied).toMatchObject({ size: 9, contentType: 'video/mp4' });
    expect(copied?.lastModified).toBeInstanceOf(Date);

    await storage.remove('copy.mp4');
    await storage.remove('direct.png');
    expect(await storage.list()).toEqual([]);
    // Missing objects are a no-op for cleanup; stat still reports 404.
    await expect(storage.remove('copy.mp4')).resolves.toBeUndefined();
    await expect(storage.stat('copy.mp4')).rejects.toThrow();
  });

it('presigns a local key and the returned upload URL accepts it', async () => {
    const { app } = await setup();
    const presign = await request(app)
      .post('/admin/media/presign')
      .set('x-test-role', 'admin')
      .send({ filename: 'clip.mp4', contentType: 'video/mp4' });

    expect(presign.status, JSON.stringify(presign.body)).toBe(200);
    const key = String(presign.body.key);
    expect(key).toMatch(MEDIA_KEY_PATTERN);
    expect(key.endsWith('.mp4')).toBe(true);
    expect(presign.body.uploadUrl).toBe(
      `http://portal.test/api/v1/admin/media/upload?key=${encodeURIComponent(key)}`,
    );
    expect(presign.body.publicUrl).toBe(`http://portal.test/api/v1/media/${key}`);
    expect(presign.body.expiresIn).toBe(MEDIA_PRESIGN_EXPIRES_IN);
    expect(presign.body.driver).toBe('local');
    expect(presign.body.path).toBe(`/api/v1/media/${key}`);

    const uploaded = await request(app)
      .post(`/admin/media/upload?key=${encodeURIComponent(key)}`)
      .set('x-test-role', 'admin')
      .set('Content-Type', 'video/mp4')
      .send(Buffer.from('fake-mp4'));
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.key).toBe(key);
  });

  it('requires an admin for presign/upload and rejects traversal keys', async () => {
    const { app, dir } = await setup();

    const anonymous = await request(app)
      .post('/admin/media/presign')
      .send({ filename: 'a.png', contentType: 'image/png' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ error: '请先登录' });

    const learner = await request(app)
      .post('/admin/media/upload')
      .set('x-test-role', 'learner')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'));
    expect(learner.status).toBe(403);
    expect(learner.body).toMatchObject({ error: '需要管理员权限' });

    // Legacy raw upload keeps the 50 MiB ceiling even when MEDIA_MAX_BYTES is 2 GiB.
    expect(legacyUploadCap(makeEnv())).toBe(LEGACY_MEDIA_MAX_BYTES);
    expect(legacyUploadCap(makeEnv({ MEDIA_MAX_BYTES: '1024' }))).toBe(1024);
    expect(LEGACY_MEDIA_MAX_BYTES).toBe(50 * 1024 * 1024);

    for (const bad of ['..%2Fsecret', '.hidden', 'nested%2Fkey']) {
      const res = await request(app).get(`/media/${bad}`);
      expect(res.status, `key ${bad}`).toBe(404);
    }

    const evilUpload = await request(app)
      .post('/admin/media/upload?key=..%2Fescape')
      .set('x-test-role', 'admin')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'));
    expect(evilUpload.status).toBe(400);

    // The escape attempt never wrote outside the media root.
    const outside = path.join(dir, '..', 'escape');
    await expect(fs.stat(outside)).rejects.toBeTruthy();
  });
});

describe('s3 media driver', () => {
  function s3Env(overrides: Record<string, string> = {}): Env {
    return makeEnv({
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'portal-media',
      S3_ACCESS_KEY: 'test-access',
      S3_SECRET_KEY: 'test-secret',
      S3_FORCE_PATH_STYLE: '1',
      S3_PUBLIC_URL: 'https://cdn.example.com/media',
      ...overrides,
    });
  }

  type PresignCall = {
    command: PutObjectCommand | GetObjectCommand;
    expiresIn: number;
  };

  function fakeS3Storage(env: Env, calls: PresignCall[]) {
    return createS3Storage({
      env,
      client: { send: async () => ({}) },
      presign: async (_client, command, options) => {
        calls.push({ command: command as PutObjectCommand | GetObjectCommand, expiresIn: options.expiresIn });
        if (command instanceof PutObjectCommand) {
          return `https://signed.example/put?key=${String(command.input.Key)}`;
        }
        return `https://signed.example/get?key=${String((command as GetObjectCommand).input.Key)}`;
      },
    });
  }

  it('presigns PUT/GET and returns a configured public URL', async () => {
    const env = s3Env();
    const calls: PresignCall[] = [];
    const storage = fakeS3Storage(env, calls);
    const app = buildApp(env, storage);

    const presign = await request(app)
      .post('/admin/media/presign')
      .set('x-test-role', 'admin')
      .send({ filename: 'demo.mp4', contentType: 'video/mp4' });

    expect(presign.status, JSON.stringify(presign.body)).toBe(200);
    const key = String(presign.body.key);
    expect(key).toMatch(MEDIA_KEY_PATTERN);
    expect(presign.body.uploadUrl).toBe(`https://signed.example/put?key=${key}`);
    expect(presign.body.publicUrl).toBe(`https://cdn.example.com/media/${key}`);
    expect(presign.body.expiresIn).toBe(MEDIA_PRESIGN_EXPIRES_IN);
    expect(presign.body.driver).toBe('s3');
    // The site-local path is stable even when publicUrl is an external CDN.
    expect(presign.body.path).toBe(`/api/v1/media/${key}`);

    expect(calls).toHaveLength(1);
    const put = calls[0]!.command;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect((put as PutObjectCommand).input).toMatchObject({
      Bucket: 'portal-media',
      Key: key,
      ContentType: 'video/mp4',
    });
    expect(calls[0]!.expiresIn).toBe(MEDIA_PRESIGN_EXPIRES_IN);
  });

  it('redirects GET /media/:key to a presigned GET and rejects raw upload', async () => {
    const env = s3Env();
    const calls: PresignCall[] = [];
    const storage = fakeS3Storage(env, calls);
    const app = buildApp(env, storage);

    const served = await request(app).get('/media/abc123.mp4').redirects(0);
    expect(served.status).toBe(302);
    expect(served.headers.location).toBe('https://signed.example/get?key=abc123.mp4');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBeInstanceOf(GetObjectCommand);
    expect((calls[0]!.command as GetObjectCommand).input).toMatchObject({
      Bucket: 'portal-media',
      Key: 'abc123.mp4',
    });

    const upload = await request(app)
      .post('/admin/media/upload')
      .set('x-test-role', 'admin')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'));
    expect(upload.status).toBe(400);
    expect(String(upload.body.error)).toContain('预签名');
  });

  it('falls back to a presigned GET when S3_PUBLIC_URL is unset', async () => {
    const env = s3Env({ S3_PUBLIC_URL: '' });
    const storage = fakeS3Storage(env, []);
    await expect(storage.publicUrl('abc123.mp4', 60)).resolves.toBe(
      'https://signed.example/get?key=abc123.mp4',
    );
  });

  it('streams putFile, stats, lists pages and deletes without a network', async () => {
    const env = s3Env();
    const calls: unknown[] = [];
    const client = {
      send: async (command: unknown) => {
        calls.push(command);
        if (command instanceof PutObjectCommand) {
          (command.input.Body as { destroy?: () => void } | undefined)?.destroy?.();
          return {};
        }
        if (command instanceof HeadObjectCommand) {
          return {
            ContentLength: 5,
            ContentType: 'video/mp4',
            LastModified: new Date('2026-01-01T00:00:00Z'),
          };
        }
        if (command instanceof ListObjectsV2Command) {
          if (command.input.ContinuationToken === undefined) {
            return {
              Contents: [{ Key: 'a.mp4', Size: 3, LastModified: new Date('2026-01-01T00:00:00Z') }],
              IsTruncated: true,
              NextContinuationToken: 'page-2',
            };
          }
          return {
            Contents: [{ Key: 'b.png', Size: 4, LastModified: new Date('2026-01-02T00:00:00Z') }],
            IsTruncated: false,
          };
        }
        if (command instanceof DeleteObjectCommand) return {};
        return {};
      },
    };
    const storage = createS3Storage({ env, client, presign: async () => 'signed' });

    const sourceDir = await tempDir();
    const source = path.join(sourceDir, 'upload.bin');
    await fs.writeFile(source, 'hi');

    await expect(storage.putFile('new.mp4', source, 'video/mp4')).resolves.toEqual({
      key: 'new.mp4',
      size: 2,
    });
    const put = calls.find((command) => command instanceof PutObjectCommand) as PutObjectCommand;
    expect(put.input).toMatchObject({
      Bucket: 'portal-media',
      Key: 'new.mp4',
      ContentLength: 2,
      ContentType: 'video/mp4',
    });

    await expect(storage.stat('a.mp4')).resolves.toEqual({ size: 5, contentType: 'video/mp4' });
    const head = calls.find((command) => command instanceof HeadObjectCommand) as HeadObjectCommand;
    expect(head.input).toMatchObject({ Bucket: 'portal-media', Key: 'a.mp4' });

    const objects = await storage.list();
    expect(objects.map((object) => object.key).sort()).toEqual(['a.mp4', 'b.png']);
    expect(objects.find((object) => object.key === 'b.png')).toMatchObject({
      size: 4,
      contentType: 'image/png',
    });
    const lists = calls.filter((command) => command instanceof ListObjectsV2Command) as ListObjectsV2Command[];
    expect(lists).toHaveLength(2);
    expect(lists[1]!.input.ContinuationToken).toBe('page-2');

    await storage.remove('a.mp4');
    const deleted = calls.find((command) => command instanceof DeleteObjectCommand) as DeleteObjectCommand;
    expect(deleted.input).toMatchObject({ Bucket: 'portal-media', Key: 'a.mp4' });

    const missing = createS3Storage({
      env,
      client: {
        send: async () => {
          throw Object.assign(new Error('missing'), { name: 'NotFound' });
        },
      },
      presign: async () => 'signed',
    });
    await expect(missing.stat('gone.mp4')).rejects.toMatchObject({ status: 404 });
  });
});