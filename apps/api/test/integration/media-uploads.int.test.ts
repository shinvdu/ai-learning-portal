/**
 * Resumable upload + media library integration tests (F097).
 *
 * Uses a dedicated `ai_portal_media_test` database (never `ai_portal` or the
 * shared `ai_portal_test`, so parallel suites cannot interfere) and a temporary
 * MEDIA_DIR per test. The media router is mounted directly with an
 * `x-test-user` header standing in for session resolution, so no Redis or CSRF
 * middleware is involved.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql, eq } from 'drizzle-orm';
import { chapters, courses, createDb, createPool, type Db } from '@portal/db';
import type { Env } from '@portal/config';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/lib/logger.js';
import { createErrorHandler } from '../../src/middleware/error-handler.js';
import { createMediaRouter } from '../../src/modules/media/routes.js';
import type { AuthUser } from '../../src/lib/types.js';
import { ensureDatabase, migrateTestDatabase } from '../helpers/database.js';

const DATABASE_NAME = 'ai_portal_media_test';
const DATABASE_URL = `postgres://portal:portal@127.0.0.1:5433/${DATABASE_NAME}`;
const ADMIN: AuthUser = {
  id: 0,
  email: 'media-admin@portal.test',
  name: 'Media Admin',
  role: 'admin',
  emailVerified: true,
  mfaEnabled: false,
};
const OTHER: AuthUser = { ...ADMIN, id: 0, email: 'other-admin@portal.test' };

let db: Db;
let pool: ReturnType<typeof createPool>;
const createdDirs: string[] = [];

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-media-int-'));
  createdDirs.push(dir);
  return dir;
}

function buildApp(env: Env): Express {
  const app = express();
  app.locals.env = env;
  app.locals.db = db;
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header('x-test-user');
    req.user = who === 'other' ? OTHER : who === 'anon' ? null : ADMIN;
    next();
  });
  app.use(createMediaRouter({ env, db }));
  app.use(createErrorHandler(createLogger(env)));
  return app;
}

/** Buffer non-text media responses (superagent leaves video bodies unbuffered). */
function binaryParser(res: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer | string) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
  );
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

function admin(app: Express, method: 'get' | 'post' | 'put' | 'delete', url: string) {
  return request(app)[method](url).set('x-test-user', 'admin');
}

async function createSession(
  app: Express,
  filename: string,
  contentType: string,
  data: Buffer,
) {
  const res = await admin(app, 'post', '/admin/media/uploads').send({
    filename,
    contentType,
    totalSize: data.byteLength,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as {
    id: string;
    key: string;
    chunkSize: number;
    totalChunks: number;
    uploadedChunks: number[];
    expiresAt: string;
    status: string;
  };
}

async function uploadChunk(app: Express, id: string, index: number, chunk: Buffer) {
  return admin(app, 'put', `/admin/media/uploads/${id}/chunks/${index}`)
    .set('Content-Type', 'application/octet-stream')
    .send(chunk);
}

/** Create a session, upload every chunk and complete it. */
async function uploadFile(app: Express, filename: string, contentType: string, data: Buffer) {
  const session = await createSession(app, filename, contentType, data);
  for (let index = 0; index < session.totalChunks; index += 1) {
    const chunk = data.subarray(index * session.chunkSize, (index + 1) * session.chunkSize);
    const res = await uploadChunk(app, session.id, index, chunk);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const complete = await admin(app, 'post', `/admin/media/uploads/${session.id}/complete`);
  expect(complete.status, JSON.stringify(complete.body)).toBe(200);
  return complete.body as { key: string; path: string; driver: string; size: number };
}

async function seedReference(target: 'course' | 'chapter', key: string | null): Promise<void> {
  if (target === 'course') {
    await db
      .update(courses)
      .set({ video_mode: key ? 'custom' : 'none', video: key ? { src: `/api/v1/media/${key}` } : null })
      .where(eq(courses.id, 'C1'));
  } else {
    await db
      .update(chapters)
      .set({ video_mode: key ? 'custom' : 'none', video: key ? { src: `/api/v1/media/${key}` } : null })
      .where(eq(chapters.course_id, 'C1'));
  }
}

beforeAll(async () => {
  await ensureDatabase(DATABASE_URL, DATABASE_NAME);
  await migrateTestDatabase(DATABASE_URL);
  pool = createPool({ connectionString: DATABASE_URL });
  db = createDb(pool);

  await db.execute(sql`delete from media_uploads`);
  await db.execute(sql`delete from chapters`);
  await db.execute(sql`delete from courses`);
  await db.execute(sql`delete from users`);

  const adminRows = await db.execute(sql`
    insert into users (email, name, password_hash, role, email_verified)
    values ('media-admin@portal.test', 'Media Admin', 'x', 'admin', true)
    returning id
  `);
  const otherRows = await db.execute(sql`
    insert into users (email, name, password_hash, role, email_verified)
    values ('other-admin@portal.test', 'Other Admin', 'x', 'admin', true)
    returning id
  `);
  ADMIN.id = Number((adminRows.rows[0] as { id: number }).id);
  OTHER.id = Number((otherRows.rows[0] as { id: number }).id);

  await db.execute(sql`
    insert into courses (id, name, category, teacher, level, video_mode)
    values ('C1', 'Media Test Course', 'test', 'tester', 'beginner', 'none')
  `);
  await db.execute(sql`
    insert into chapters (course_id, idx, title, body, video_mode)
    values ('C1', 1, 'Chapter 1', 'body', 'none')
  `);
});

beforeEach(async () => {
  await db.execute(sql`delete from media_uploads`);
  await seedReference('course', null);
  await seedReference('chapter', null);
});

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

afterAll(async () => {
  await pool.end();
});

describe('resumable media uploads', () => {
  it('uploads multiple chunks, resumes, completes and serves with Range', async () => {
    const dir = await tempDir();
    const env = makeEnv({ MEDIA_DIR: dir, MEDIA_CHUNK_SIZE: '4', MEDIA_MAX_BYTES: '1024' });
    const app = buildApp(env);
    const data = Buffer.from('abcdefghij');

    const session = await createSession(app, 'clip.mp4', 'video/mp4', data);
    expect(session).toMatchObject({
      chunkSize: 4,
      totalChunks: 3,
      uploadedChunks: [],
      status: 'uploading',
    });
    expect(session.key.endsWith('.mp4')).toBe(true);

    expect((await uploadChunk(app, session.id, 0, data.subarray(0, 4))).status).toBe(200);
    expect((await uploadChunk(app, session.id, 1, data.subarray(4, 8))).status).toBe(200);
    // Re-uploading a chunk is idempotent.
    expect((await uploadChunk(app, session.id, 0, data.subarray(0, 4))).status).toBe(200);

    const resumed = await admin(app, 'get', `/admin/media/uploads/${session.id}`);
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect(resumed.body.uploadedChunks).toEqual([0, 1]);
    expect(resumed.body.status).toBe('uploading');

    // Completing before the last chunk is a 400 and keeps the session alive.
    const early = await admin(app, 'post', `/admin/media/uploads/${session.id}/complete`);
    expect(early.status).toBe(400);

    expect((await uploadChunk(app, session.id, 2, data.subarray(8))).status).toBe(200);
    const complete = await admin(app, 'post', `/admin/media/uploads/${session.id}/complete`);
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
    expect(complete.body).toEqual({
      key: session.key,
      path: `/api/v1/media/${session.key}`,
      driver: 'local',
      size: 10,
    });

    const served = await request(app).get(`/media/${session.key}`).parse(binaryParser);
    expect(served.status).toBe(200);
    expect((served.body as Buffer).toString()).toBe('abcdefghij');
    const partial = await request(app)
      .get(`/media/${session.key}`)
      .set('Range', 'bytes=0-3')
      .parse(binaryParser);
    expect(partial.status).toBe(206);
    expect((partial.body as Buffer).toString()).toBe('abcd');

    // Staged chunks are gone, the final object and metadata remain.
    await expect(fs.stat(path.join(dir, '.uploads', session.id))).rejects.toBeTruthy();
    const meta = JSON.parse(
      await fs.readFile(path.join(dir, '.meta', `${session.key}.json`), 'utf8'),
    ) as { contentType: string };
    expect(meta.contentType).toBe('video/mp4');

    const library = await admin(app, 'get', '/admin/media');
    expect(library.status, JSON.stringify(library.body)).toBe(200);
    expect(library.body.total).toBe(1);
    expect(library.body.items[0]).toMatchObject({
      key: session.key,
      path: `/api/v1/media/${session.key}`,
      size: 10,
      contentType: 'video/mp4',
      references: [],
    });
  });

  it('aborts a session and removes staged chunks', async () => {
    const dir = await tempDir();
    const env = makeEnv({ MEDIA_DIR: dir, MEDIA_CHUNK_SIZE: '4' });
    const app = buildApp(env);

    const session = await createSession(app, 'abort.bin', 'application/octet-stream', Buffer.from('abcdefgh'));
    expect((await uploadChunk(app, session.id, 0, Buffer.from('abcd'))).status).toBe(200);
    await expect(fs.stat(path.join(dir, '.uploads', session.id))).resolves.toBeTruthy();

    const aborted = await admin(app, 'delete', `/admin/media/uploads/${session.id}`);
    expect(aborted.status, JSON.stringify(aborted.body)).toBe(200);
    expect(aborted.body).toEqual({ ok: true, status: 'aborted' });
    await expect(fs.stat(path.join(dir, '.uploads', session.id))).rejects.toBeTruthy();

    const status = await admin(app, 'get', `/admin/media/uploads/${session.id}`);
    expect(status.body.status).toBe('aborted');
    // Chunks can no longer be added once aborted.
    const late = await uploadChunk(app, session.id, 1, Buffer.from('efgh'));
    expect(late.status).toBe(409);
  });

  it('expires sessions past MEDIA_UPLOAD_TTL_HOURS and purges their chunks', async () => {
    const dir = await tempDir();
    const env = makeEnv({ MEDIA_DIR: dir, MEDIA_CHUNK_SIZE: '4' });
    const app = buildApp(env);

    const session = await createSession(app, 'stale.bin', 'application/octet-stream', Buffer.from('abcdefgh'));
    expect((await uploadChunk(app, session.id, 0, Buffer.from('abcd'))).status).toBe(200);
    await db.execute(
      sql`update media_uploads set expires_at = now() - interval '2 hours' where id = ${session.id}`,
    );

    const status = await admin(app, 'get', `/admin/media/uploads/${session.id}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('expired');
    await expect(fs.stat(path.join(dir, '.uploads', session.id))).rejects.toBeTruthy();

    const complete = await admin(app, 'post', `/admin/media/uploads/${session.id}/complete`);
    expect(complete.status).toBe(409);
  });

  it('hides sessions from other users and rejects non-admin callers', async () => {
    const dir = await tempDir();
    const env = makeEnv({ MEDIA_DIR: dir });
    const app = buildApp(env);

    const session = await createSession(app, 'private.bin', 'application/octet-stream', Buffer.from('x'));

    const other = await request(app)
      .get(`/admin/media/uploads/${session.id}`)
      .set('x-test-user', 'other');
    expect(other.status).toBe(404);

    const anonymous = await request(app)
      .post('/admin/media/uploads')
      .set('x-test-user', 'anon')
      .send({
      filename: 'x.bin',
      contentType: 'application/octet-stream',
      totalSize: 1,
    });
    expect(anonymous.status).toBe(401);
  });
});

describe('media library delete and cleanup', () => {
  it('refuses referenced deletes with 409 and force removes the object', async () => {
    const dir = await tempDir();
    const env = makeEnv({ MEDIA_DIR: dir, MEDIA_CHUNK_SIZE: '4' });
    const app = buildApp(env);

    const uploaded = await uploadFile(app, 'ref.mp4', 'video/mp4', Buffer.from('abcdefghij'));
    await seedReference('course', uploaded.key);

    const library = await admin(app, 'get', '/admin/media');
    const item = library.body.items.find((entry: { key: string }) => entry.key === uploaded.key);
    expect(item.references).toEqual([{ type: 'course', id: 'C1', field: 'src' }]);

    const refused = await admin(app, 'delete', `/admin/media/${uploaded.key}`);
    expect(refused.status).toBe(409);
    expect(refused.body.references).toEqual([{ type: 'course', id: 'C1', field: 'src' }]);

    const forced = await admin(app, 'delete', `/admin/media/${uploaded.key}?force=1`);
    expect(forced.status, JSON.stringify(forced.body)).toBe(200);
    expect(forced.body).toMatchObject({ ok: true, key: uploaded.key });
    await expect(fs.stat(path.join(dir, uploaded.key))).rejects.toBeTruthy();

    const served = await request(app).get(`/media/${uploaded.key}`);
    expect(served.status).toBe(404);
    await seedReference('course', null);
  });

  it('dry-runs and deletes only old unreferenced orphans', async () => {
    const dir = await tempDir();
    const env = makeEnv({
      MEDIA_DIR: dir,
      MEDIA_CHUNK_SIZE: '4',
      MEDIA_ORPHAN_GRACE_HOURS: '24',
    });
    const app = buildApp(env);

    const referenced = await uploadFile(app, 'kept.mp4', 'video/mp4', Buffer.from('keep'));
    const orphanA = await uploadFile(app, 'a.mp4', 'video/mp4', Buffer.from('aaaa'));
    const orphanB = await uploadFile(app, 'b.png', 'image/png', Buffer.from('bbbb'));
    await seedReference('chapter', referenced.key);

    // Default grace (24h): fresh orphans are protected.
    const young = await admin(app, 'post', '/admin/media/cleanup').send({ dryRun: true });
    expect(young.status, JSON.stringify(young.body)).toBe(200);
    expect(young.body).toMatchObject({
      deleted: 0,
      skippedReferenced: 1,
      skippedYoung: 2,
      purgedUploads: 0,
      items: [],
    });

    // Expired session that cleanup should purge too.
    const stale = await createSession(app, 'stale.bin', 'application/octet-stream', Buffer.from('xy'));
    expect((await uploadChunk(app, stale.id, 0, Buffer.from('xy'))).status).toBe(200);
    await db.execute(
      sql`update media_uploads set expires_at = now() - interval '2 hours' where id = ${stale.id}`,
    );

    const dry = await admin(app, 'post', '/admin/media/cleanup').send({
      dryRun: true,
      graceHours: 0,
    });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ deleted: 0, skippedReferenced: 1, skippedYoung: 0 });
    expect(dry.body.purgedUploads).toBe(1);
    expect(dry.body.items.map((item: { key: string }) => item.key).sort()).toEqual(
      [orphanA.key, orphanB.key].sort(),
    );
    // Dry-run touched nothing.
    await expect(fs.stat(path.join(dir, orphanA.key))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, '.uploads', stale.id))).resolves.toBeTruthy();

    const real = await admin(app, 'post', '/admin/media/cleanup').send({ graceHours: 0 });
    expect(real.status, JSON.stringify(real.body)).toBe(200);
    expect(real.body).toMatchObject({
      deleted: 2,
      skippedReferenced: 1,
      skippedYoung: 0,
      purgedUploads: 1,
    });
    await expect(fs.stat(path.join(dir, orphanA.key))).rejects.toBeTruthy();
    await expect(fs.stat(path.join(dir, orphanB.key))).rejects.toBeTruthy();
    await expect(fs.stat(path.join(dir, referenced.key))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, '.uploads', stale.id))).rejects.toBeTruthy();
    await seedReference('chapter', null);
  });
});