/**
 * End-to-end API integration suite (Vitest + supertest + real PostgreSQL/Redis).
 *
 * Runs the real Express app from `createApp` against `ai_portal_test` and Redis
 * DB 15. The database is migrated and reseeded once before the suite; tests
 * that mutate data clean up after themselves. The main `ai_portal` database is
 * never touched.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Redis } from 'ioredis';
import { DEMO_VIDEO } from '@portal/content';
import { generateTotp } from '@portal/domain';
import type { Db } from '@portal/db';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import type { AppConfig } from '../../src/config.js';
import {
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_DATABASE_NAME,
  TEST_DATABASE_URL,
  TEST_ENV,
  TEST_REDIS_URL,
  PROD_ENV,
} from '../helpers/test-env.js';
import { createCapturingMailer, type CapturingMailer } from '../helpers/fake-mailer.js';
import {
  deleteExtraCourses,
  ensureAdmin,
  ensureDatabase,
  migrateTestDatabase,
  openDatabase,
  prepareSeededDatabase,
} from '../helpers/database.js';

const V1 = '/api/v1';
const SEED_CSV_HEADER =
  'student_id,course_name,learning_date,learning_minutes,chapters_done,total_chapters,quiz_score';

let app: Express;
let prodApp: Express;
let secondApp: Express;
let db: Db;
let pool: ReturnType<typeof openDatabase>['pool'];
let redis: Redis;
let logger: ReturnType<typeof createLogger>;
let mailer: CapturingMailer;
let prodMailer: CapturingMailer;
let userSeq = 0;

function v1(path: string): string {
  return `${V1}${path}`;
}

function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  if (!raw) return [];
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

function cookieValue(res: request.Response, name: string): string | undefined {
  for (const header of setCookies(res)) {
    const pair = header.split(';')[0] ?? '';
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index) === name) return decodeURIComponent(pair.slice(index + 1));
  }
  return undefined;
}

function sessionCookie(res: request.Response): string | undefined {
  return cookieValue(res, 'aip_session');
}

function session(cookie: string): string {
  return `aip_session=${cookie}`;
}

function uniqueEmail(prefix: string): string {
  userSeq += 1;
  return `${prefix}.${userSeq}@portal.test`;
}

async function registerUser(
  expressApp: Express = app,
  prefix = 'learner',
): Promise<{ email: string; password: string; cookie: string; id: number }> {
  const email = uniqueEmail(prefix);
  const password = 'LearnerPass123';
  const res = await request(expressApp)
    .post(v1('/auth/register'))
    .send({ name: '测试学员', email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const cookie = sessionCookie(res);
  expect(cookie, 'register should auto-login outside production').toBeTruthy();
  return { email, password, cookie: cookie as string, id: res.body.user.id as number };
}

function login(email: string, password: string, expressApp: Express = app) {
  return request(expressApp).post(v1('/auth/login')).send({ email, password });
}

async function adminLogin(): Promise<string> {
  const res = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const cookie = sessionCookie(res);
  expect(cookie).toBeTruthy();
  return cookie as string;
}

function adminRequest(
  cookie: string,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
) {
  return request(app)[method](v1(path)).set('Cookie', session(cookie));
}

beforeAll(async () => {
  await ensureDatabase(TEST_DATABASE_URL, TEST_DATABASE_NAME);
  await migrateTestDatabase(TEST_DATABASE_URL);

  const opened = openDatabase(TEST_DATABASE_URL);
  db = opened.db;
  pool = opened.pool;
  redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 1 });
  await redis.flushdb();

  logger = createLogger(TEST_ENV);
  mailer = createCapturingMailer();
  prodMailer = createCapturingMailer();

  await prepareSeededDatabase(db);
  await ensureAdmin(db, TEST_ENV as AppConfig, logger);

  app = createApp({ db, redis, env: TEST_ENV, logger, mailer });
  secondApp = createApp({ db, redis, env: TEST_ENV, logger, mailer });
  prodApp = createApp({ db, redis, env: PROD_ENV, logger, mailer: prodMailer });
}, 60_000);

afterAll(async () => {
  try {
    await deleteExtraCourses(db);
    await prepareSeededDatabase(db);
  } catch {
    /* best-effort restore */
  }
  try {
    await redis.flushdb();
    await redis.quit();
  } catch {
    redis.disconnect();
  }
  await pool.end();
}, 30_000);

/* ------------------------------- public API ------------------------------- */

describe('public golden metrics', () => {
  it('serves /meta with the exact site-wide KPIs', async () => {
    const res = await request(app).get(v1('/meta')).expect(200);
    expect(res.body.overview).toMatchObject({
      students: 24,
      courses: 5,
      enrollments: 58,
      records: 177,
      avgCompletion: 74.3,
      avgScore: 86.4,
      scoredEnrollments: 53,
      noScoreEnrollments: 5,
      totalHours: 165.3,
    });
    expect(res.body.courses).toHaveLength(5);
    expect(res.body.dataset.source).toBeTruthy();
  });

  it('serves /courses with per-course stats and a stable overview', async () => {
    const res = await request(app).get(v1('/courses')).expect(200);
    expect(res.body.courses).toHaveLength(5);
    expect(res.body.categories).toHaveLength(4);

    const python = res.body.courses.find(
      (course: { name: string }) => course.name === 'Python 数据分析',
    );
    expect(python).toBeTruthy();
    expect(python.stats).toMatchObject({ learners: 17, records: 53, completion: 55.9 });
    expect(res.body.overview).toMatchObject({ students: 24, enrollments: 58, avgCompletion: 74.3 });
  });

  it('serves /courses/C3 with 17 learners, 55.9% and monotonic chapter reach', async () => {
    const res = await request(app).get(v1('/courses/C3')).expect(200);
    expect(res.body.course).toMatchObject({ id: 'C3', name: 'Python 数据分析' });
    expect(res.body.stats).toMatchObject({ learners: 17, records: 53, completion: 55.9 });

    const chapters = res.body.chapterStats as { reachRate: number | null }[];
    expect(chapters).toHaveLength(8);
    expect(chapters[0]?.reachRate).toBe(100);

    const rates = chapters
      .map((chapter) => chapter.reachRate)
      .filter((rate): rate is number => typeof rate === 'number');
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]! <= rates[i - 1]! + 1e-9).toBe(true);
    }
  });

  it('serves /chapters/C3/4 with neighbours and reach stats', async () => {
    const res = await request(app).get(v1('/chapters/C3/4')).expect(200);
    expect(res.body.course).toMatchObject({ id: 'C3', name: 'Python 数据分析' });
    expect(res.body.chapter).toMatchObject({ idx: 4 });
    expect(res.body.chapter.body.length).toBeGreaterThan(0);
    expect(res.body.chapter.video).toBeTruthy();
    expect(res.body.stats).toMatchObject({ idx: 4 });
    expect(res.body.chapterStats).toHaveLength(8);
    expect(res.body.prev.idx).toBe(3);
    expect(res.body.next.idx).toBe(5);
    expect(Array.isArray(res.body.relatedQuiz)).toBe(true);
  });

  it('serves /knowledge/C1 with the stored knowledge payload', async () => {
    const res = await request(app).get(v1('/knowledge/C1')).expect(200);
    expect(res.body.course).toMatchObject({ id: 'C1' });
    expect(res.body.knowledge).toBeTruthy();
  });

  it('serves /dashboard unfiltered with the golden overview', async () => {
    const res = await request(app).get(v1('/dashboard')).expect(200);
    expect(res.body.overview).toMatchObject({
      students: 24,
      courses: 5,
      enrollments: 58,
      avgCompletion: 74.3,
      avgScore: 86.4,
      totalHours: 165.3,
    });
    expect(res.body.filter).toBeNull();
    expect(res.body.byCourse).toHaveLength(5);
    expect(res.body.courseOptions).toHaveLength(5);
    expect(res.body.daily.length).toBeGreaterThan(0);
    expect(res.body.weekday).toHaveLength(7);
    expect(res.body.insights.length).toBeGreaterThan(0);
  });

  it('serves /dashboard?course=Python 数据分析 filtered to 17 learners / 55.9%', async () => {
    const res = await request(app)
      .get(v1('/dashboard'))
      .query({ course: 'Python 数据分析' })
      .expect(200);
    expect(res.body.filter).toBe('Python 数据分析');
    expect(res.body.byCourse).toHaveLength(1);
    expect(res.body.byCourse[0]).toMatchObject({ learners: 17, records: 53, completion: 55.9 });
    expect(res.body.overview).toMatchObject({ students: 17, enrollments: 17 });
  });

  it('serves /insights with overview, per-course stats and pitfalls', async () => {
    const res = await request(app).get(v1('/insights')).expect(200);
    expect(res.body.overview).toMatchObject({ students: 24, avgCompletion: 74.3, avgScore: 86.4 });
    expect(res.body.byCourse).toHaveLength(5);
    expect(res.body.insights.length).toBeGreaterThan(0);
    expect(res.body.pitfalls.length).toBeGreaterThan(0);
  });
});

/* ------------------------------ HTTP contract ------------------------------ */

describe('HTTP contract and middleware', () => {
  it('returns the v1 404 envelope for unknown API routes on both prefixes', async () => {
    const v1Res = await request(app).get(v1('/does-not-exist')).expect(404);
    expect(v1Res.body).toEqual({ error: '接口不存在' });
    const legacy = await request(app).get('/api/does-not-exist').expect(404);
    expect(legacy.body).toEqual({ error: '接口不存在' });
  });

  it('rejects a body over 2MB with 413', async () => {
    const res = await request(app)
      .post(v1('/auth/login'))
      .send({
        email: 'nobody@portal.test',
        password: 'x',
        padding: 'x'.repeat(2 * 1024 * 1024 + 100),
      })
      .expect(413);
    expect(res.body).toEqual({ error: '请求体超过 2MB 限制' });
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post(v1('/auth/login'))
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body).toEqual({ error: '请求体不是合法 JSON' });
  });

  it('sets security headers and no-store on API responses', async () => {
    const res = await request(app).get(v1('/meta')).expect(200);
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('marks the legacy /api alias with Deprecation and a successor Link', async () => {
    const res = await request(app).get('/api/meta').expect(200);
    expect(res.headers.deprecation).toBe('true');
    expect(String(res.headers.link)).toBe('</api/v1/meta>; rel="successor-version"');
    expect(res.body.overview.students).toBe(24);
  });

  it('serves liveness and readiness', async () => {
    const health = await request(app).get('/healthz').expect(200);
    expect(health.body).toMatchObject({ ok: true });
    expect(typeof health.body.uptime).toBe('number');
    const ready = await request(app).get('/readyz').expect(200);
    expect(ready.body).toEqual({ ok: true });
  });
});

/* ---------------------------------- auth ---------------------------------- */

describe('auth: register / login / logout / verification', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  it('auto-logs in dev registrations and resolves /auth/me', async () => {
    const email = uniqueEmail('dev-register');
    const res = await request(app)
      .post(v1('/auth/register'))
      .send({ name: '开发学员', email, password: 'LearnerPass123' })
      .expect(201);
    expect(res.body.user).toMatchObject({
      email,
      role: 'learner',
      emailVerified: true,
      mfaEnabled: false,
    });
    const cookie = sessionCookie(res);
    expect(cookie).toBeTruthy();

    const me = await request(app).get(v1('/auth/me')).set('Cookie', session(cookie!)).expect(200);
    expect(me.body.user).toMatchObject({ email, role: 'learner' });
  });

  it('logs in, logs out and clears the session', async () => {
    const learner = await registerUser(app, 'session');

    const loginRes = await login(learner.email, learner.password).expect(200);
    expect(loginRes.body.user.email).toBe(learner.email);
    const cookie = sessionCookie(loginRes);
    expect(cookie).toBeTruthy();

    const me = await request(app).get(v1('/auth/me')).set('Cookie', session(cookie!)).expect(200);
    expect(me.body.user.email).toBe(learner.email);

    const logout = await request(app)
      .post(v1('/auth/logout'))
      .set('Cookie', session(cookie!))
      .expect(200);
    expect(logout.body).toEqual({ ok: true });

    const after = await request(app).get(v1('/auth/me')).set('Cookie', session(cookie!)).expect(200);
    expect(after.body.user).toBeNull();
  });

  it('requires explicit verification in production-style mode (mail token then 403 unverified)', async () => {
    prodMailer.clear();
    const email = uniqueEmail('prod');
    const password = 'LearnerPass123';

    const reg = await request(prodApp)
      .post(v1('/auth/register'))
      .send({ name: '生产学员', email, password });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect(reg.body).toEqual({ verificationRequired: true, email });
    expect(sessionCookie(reg)).toBeUndefined();

    const token = prodMailer.tokenFor(email, 'verify');
    expect(token, 'verification mail should be captured').toBeTruthy();

    const early = await request(prodApp).post(v1('/auth/login')).send({ email, password }).expect(403);
    expect(early.body).toEqual({ error: '请先验证邮箱后再登录', code: 'EMAIL_UNVERIFIED' });

    const verified = await request(prodApp)
      .post(v1('/auth/verify-email'))
      .send({ token })
      .expect(200);
    expect(verified.body.user).toMatchObject({ email, emailVerified: true });
    expect(sessionCookie(verified)).toBeTruthy();

    await request(prodApp).post(v1('/auth/login')).send({ email, password }).expect(200);

    const reuse = await request(prodApp)
      .post(v1('/auth/verify-email'))
      .send({ token })
      .expect(400);
    expect(reuse.body).toEqual({ error: '验证链接无效或已过期' });
  });
});

describe('auth: lockout and admin unlock', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  it('locks after 5 failures and unlocks from the admin API', async () => {
    const learner = await registerUser(app, 'lock');
    const adminCookie = await adminLogin();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await login(learner.email, 'WrongPass123');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: '邮箱或密码错误' });
    }
    const fifth = await login(learner.email, 'WrongPass123');
    expect(fifth.status).toBe(423);
    expect(fifth.body).toEqual({ error: '账号已临时锁定，请 15 分钟后再试' });

    const whileLocked = await login(learner.email, learner.password);
    expect(whileLocked.status).toBe(423);

    const users = await adminRequest(adminCookie, 'get', '/admin/users').expect(200);
    const row = (users.body.users as { id: number; locked_until: number | null }[]).find(
      (user) => user.id === learner.id,
    );
    expect(row?.locked_until).toBeTruthy();

    const unlocked = await adminRequest(adminCookie, 'patch', `/admin/users/${learner.id}`)
      .send({ unlock: true })
      .expect(200);
    expect(unlocked.body.user).toMatchObject({ failed_attempts: 0, locked_until: null });

    await login(learner.email, learner.password).expect(200);
  });
});

describe('auth: MFA setup / enable / login / recovery', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  it('enables TOTP, challenges login, accepts TOTP and a single-use recovery code', async () => {
    const learner = await registerUser(app, 'mfa');

    const setup = await request(app)
      .post(v1('/auth/mfa/setup'))
      .set('Cookie', session(learner.cookie))
      .expect(200);
    expect(setup.body.secret).toBeTruthy();
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');
    const secret = setup.body.secret as string;

    const enable = await request(app)
      .post(v1('/auth/mfa/enable'))
      .set('Cookie', session(learner.cookie))
      .send({ code: generateTotp(secret) })
      .expect(200);
    expect(enable.body.recoveryCodes).toHaveLength(8);
    const recoveryCode = enable.body.recoveryCodes[0] as string;

    const challenge = await login(learner.email, learner.password).expect(200);
    expect(challenge.body).toMatchObject({ mfaRequired: true });
    expect(challenge.body.challengeToken).toBeTruthy();
    expect(sessionCookie(challenge)).toBeUndefined();

    const success = await request(app)
      .post(v1('/auth/mfa'))
      .send({ challengeToken: challenge.body.challengeToken, code: generateTotp(secret) })
      .expect(200);
    expect(success.body.user).toMatchObject({ email: learner.email, mfaEnabled: true });
    expect(sessionCookie(success)).toBeTruthy();

    const challenge2 = await login(learner.email, learner.password).expect(200);
    const recovery = await request(app)
      .post(v1('/auth/mfa'))
      .send({ challengeToken: challenge2.body.challengeToken, code: recoveryCode })
      .expect(200);
    expect(recovery.body.user.mfaEnabled).toBe(true);

    const challenge3 = await login(learner.email, learner.password).expect(200);
    const burned = await request(app)
      .post(v1('/auth/mfa'))
      .send({ challengeToken: challenge3.body.challengeToken, code: recoveryCode })
      .expect(401);
    expect(burned.body).toEqual({ error: '验证码不正确' });
  });
});

describe('auth: password reset and change', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  it('resets with a single-use token and revokes existing sessions', async () => {
    const learner = await registerUser(app, 'reset');
    mailer.clear();

    await request(app)
      .post(v1('/auth/forgot-password'))
      .send({ email: learner.email })
      .expect(200);
    const token = mailer.tokenFor(learner.email, 'reset');
    expect(token, 'reset mail should be captured').toBeTruthy();

    const newPassword = 'BrandNewPass456';
    const reset = await request(app)
      .post(v1('/auth/reset-password'))
      .send({ token, password: newPassword })
      .expect(200);
    expect(reset.body).toEqual({ ok: true });

    const existing = await request(app)
      .get(v1('/auth/me'))
      .set('Cookie', session(learner.cookie))
      .expect(200);
    expect(existing.body.user).toBeNull();

    const reuse = await request(app)
      .post(v1('/auth/reset-password'))
      .send({ token, password: 'AnotherPass789' })
      .expect(400);
    expect(reuse.body).toEqual({ error: '重置链接无效或已过期' });

    await login(learner.email, newPassword).expect(200);
    const oldPassword = await login(learner.email, learner.password);
    expect(oldPassword.status).toBe(401);
  });

  it('change-password keeps the current session and revokes the others', async () => {
    const learner = await registerUser(app, 'change');
    const second = await login(learner.email, learner.password).expect(200);
    const secondCookie = sessionCookie(second);
    expect(secondCookie).toBeTruthy();

    const newPassword = 'ChangedPass456';
    await request(app)
      .post(v1('/auth/change-password'))
      .set('Cookie', session(learner.cookie))
      .send({ currentPassword: learner.password, newPassword })
      .expect(200);

    const current = await request(app)
      .get(v1('/auth/me'))
      .set('Cookie', session(learner.cookie))
      .expect(200);
    expect(current.body.user.email).toBe(learner.email);

    const revoked = await request(app)
      .get(v1('/auth/me'))
      .set('Cookie', session(secondCookie!))
      .expect(200);
    expect(revoked.body.user).toBeNull();

    await login(learner.email, newPassword).expect(200);
  });
});

describe('auth: last-admin and self guards', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  it('refuses to demote/disable the last admin and to demote the acting admin', async () => {
    const adminCookie = await adminLogin();
    const me = await request(app)
      .get(v1('/auth/me'))
      .set('Cookie', session(adminCookie))
      .expect(200);
    const adminId = me.body.user.id as number;

    const disableSelf = await adminRequest(adminCookie, 'patch', `/admin/users/${adminId}`)
      .send({ active: false })
      .expect(400);
    expect(disableSelf.body.errors).toContain('不能移除最后一个启用的管理员');

    const demoteSelfLast = await adminRequest(adminCookie, 'patch', `/admin/users/${adminId}`)
      .send({ role: 'learner' })
      .expect(400);
    expect(demoteSelfLast.body.errors).toContain('不能移除最后一个启用的管理员');

    const secondAdminEmail = uniqueEmail('admin2');
    const created = await adminRequest(adminCookie, 'post', '/admin/users')
      .send({
        name: '第二管理员',
        email: secondAdminEmail,
        password: 'SecondAdminPass123',
        role: 'admin',
      })
      .expect(201);
    const secondAdminId = created.body.user.id as number;

    const selfGuard = await adminRequest(adminCookie, 'patch', `/admin/users/${adminId}`)
      .send({ role: 'learner' })
      .expect(400);
    expect(selfGuard.body.errors).toContain('不能降级或停用当前登录的管理员');

    await adminRequest(adminCookie, 'patch', `/admin/users/${secondAdminId}`)
      .send({ role: 'learner' })
      .expect(200);

    const lastAgain = await adminRequest(adminCookie, 'patch', `/admin/users/${adminId}`)
      .send({ active: false })
      .expect(400);
    expect(lastAgain.body.errors).toContain('不能移除最后一个启用的管理员');
  });
});

/* --------------------------------- CSRF ---------------------------------- */

describe('CSRF and Origin matrix', () => {
  it('rejects a same-origin request without the CSRF token', async () => {
    const res = await request(app)
      .post(v1('/auth/logout'))
      .set('Host', 'portal.test')
      .set('Origin', 'http://portal.test')
      .expect(403);
    expect(res.body.error).toBe('CSRF 校验失败，请刷新页面后重试');
  });

  it('accepts the matching cookie/header token', async () => {
    const csrf = await request(app).get(v1('/auth/csrf')).expect(200);
    const token = csrf.body.csrfToken as string;
    expect(token).toBeTruthy();
    expect(cookieValue(csrf, 'aip_csrf')).toBe(token);

    const res = await request(app)
      .post(v1('/auth/logout'))
      .set('Host', 'portal.test')
      .set('Origin', 'http://portal.test')
      .set('Cookie', `aip_csrf=${token}`)
      .set('X-CSRF-Token', token)
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows requests without an Origin header (non-browser clients)', async () => {
    const res = await request(app).post(v1('/auth/logout')).expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects cross-origin mutating requests before CSRF', async () => {
    const res = await request(app)
      .post(v1('/auth/logout'))
      .set('Host', 'portal.test')
      .set('Origin', 'http://evil.test')
      .expect(403);
    expect(res.body).toEqual({ error: '跨站请求被拒绝' });
  });
});

/* ------------------------------- rate limits ------------------------------ */

describe('rate limits (Redis fixed window)', () => {
  afterEach(async () => {
    await redis.flushdb();
  });

  it('returns 429 on the 21st public-auth request for one IP', async () => {
    await redis.flushdb();
    for (let i = 1; i <= 20; i += 1) {
      const res = await request(app)
        .post(v1('/auth/forgot-password'))
        .send({ email: 'nobody@portal.test' });
      expect(res.status, `request ${i}`).toBe(200);
    }
    const limited = await request(app)
      .post(v1('/auth/forgot-password'))
      .send({ email: 'nobody@portal.test' })
      .expect(429);
    expect(limited.body).toEqual({ error: '尝试次数过多，请稍后再试' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('clears the bucket after a successful login', async () => {
    await redis.flushdb();
    for (let i = 0; i < 19; i += 1) {
      const res = await login(uniqueEmail('missing'), 'WrongPass123');
      expect(res.status).toBe(401);
    }
    await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD).expect(200);

    for (let i = 1; i <= 20; i += 1) {
      const res = await login(uniqueEmail('missing'), 'WrongPass123');
      expect(res.status, `post-clear request ${i}`).toBe(401);
    }
    await login(uniqueEmail('missing'), 'WrongPass123').expect(429);
  });

  it('counts requests from two app instances against the same Redis bucket', async () => {
    await redis.flushdb();
    for (let i = 1; i <= 20; i += 1) {
      const res = await request(app)
        .post(v1('/auth/forgot-password'))
        .send({ email: 'nobody@portal.test' });
      expect(res.status, `instance A request ${i}`).toBe(200);
    }
    const limited = await request(secondApp)
      .post(v1('/auth/forgot-password'))
      .send({ email: 'nobody@portal.test' })
      .expect(429);
    expect(limited.body).toEqual({ error: '尝试次数过多，请稍后再试' });
  });
});

/* --------------------------------- roles --------------------------------- */

describe('role boundaries', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  const protectedGets = ['/admin/users', '/records', '/export.csv', '/admin/audit'];

  it('rejects anonymous access with 401 请先登录', async () => {
    for (const path of protectedGets) {
      const res = await request(app).get(v1(path));
      expect(res.status, path).toBe(401);
      expect(res.body).toEqual({ error: '请先登录' });
    }
  });

  it('rejects learners with 403 需要管理员权限', async () => {
    const learner = await registerUser(app, 'role');
    for (const path of protectedGets) {
      const res = await request(app).get(v1(path)).set('Cookie', session(learner.cookie));
      expect(res.status, path).toBe(403);
      expect(res.body).toEqual({ error: '需要管理员权限' });
    }
  });

  it('allows admin access to users, records, export and audit', async () => {
    const adminCookie = await adminLogin();
    const users = await adminRequest(adminCookie, 'get', '/admin/users').expect(200);
    expect(Array.isArray(users.body.users)).toBe(true);
    const records = await adminRequest(adminCookie, 'get', '/records').expect(200);
    expect(records.body.total).toBe(177);
    const audit = await adminRequest(adminCookie, 'get', '/admin/audit').expect(200);
    expect(audit.body.total).toBeGreaterThan(0);
    const csv = await adminRequest(adminCookie, 'get', '/export.csv').expect(200);
    expect(csv.text.startsWith('﻿')).toBe(true);
  });
});

/* ------------------------------- admin data ------------------------------- */

describe('admin data operations', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterEach(async () => {
    await deleteExtraCourses(db);
  });

  async function createCourse(
    adminCookie: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; name: string }> {
    const res = await adminRequest(adminCookie, 'post', '/admin/courses')
      .send(body)
      .expect(201);
    return { id: res.body.course.id as string, name: res.body.course.name as string };
  }

  it('creates C6 and renames a course without changing its records', async () => {
    const adminCookie = await adminLogin();
    const created = await createCourse(adminCookie, {
      name: '测试课程 Alpha',
      category: '测试分类',
      teacher: '测试老师',
    });
    expect(created.id).toBe('C6');

    const renamedC6 = await adminRequest(adminCookie, 'patch', '/admin/courses/C6')
      .send({ name: '测试课程 Alpha 改名' })
      .expect(200);
    expect(renamedC6.body.course).toMatchObject({ id: 'C6', name: '测试课程 Alpha 改名' });

    const before = await adminRequest(adminCookie, 'get', '/records').expect(200);
    expect(before.body.total).toBe(177);
    const pythonBefore = await adminRequest(
      adminCookie,
      'get',
      '/records?course=' + encodeURIComponent('Python 数据分析'),
    ).expect(200);
    expect(pythonBefore.body.total).toBe(53);

    const renamed = await adminRequest(adminCookie, 'patch', '/admin/courses/C3')
      .send({ name: 'Python 数据分析·重命名' })
      .expect(200);
    expect(renamed.body.course.name).toBe('Python 数据分析·重命名');

    try {
      const during = await adminRequest(adminCookie, 'get', '/records').expect(200);
      expect(during.body.total).toBe(177);
      const byNewName = await adminRequest(
        adminCookie,
        'get',
        '/records?course=' + encodeURIComponent('Python 数据分析·重命名'),
      ).expect(200);
      expect(byNewName.body.total).toBe(53);
    } finally {
      const restored = await adminRequest(adminCookie, 'patch', '/admin/courses/C3')
        .send({ name: 'Python 数据分析' })
        .expect(200);
      expect(restored.body.course.name).toBe('Python 数据分析');
    }
  });

  it('supports inherit / custom / none video states', async () => {
    const adminCookie = await adminLogin();
    const course = await createCourse(adminCookie, {
      name: '视频状态课程',
      video_mode: 'inherit',
    });

    const inherited = await request(app).get(v1(`/courses/${course.id}`)).expect(200);
    expect(inherited.body.course.video).toBeTruthy();
    expect(inherited.body.course.video.src).toBe(DEMO_VIDEO.src);

    const custom = await adminRequest(adminCookie, 'patch', `/admin/courses/${course.id}`)
      .send({
        video_mode: 'custom',
        video: { src: '/assets/demo.mp4', poster: '' },
      })
      .expect(200);
    expect(custom.body.course.video.src).toBe('/assets/demo.mp4');

    const customPublic = await request(app).get(v1(`/courses/${course.id}`)).expect(200);
    expect(customPublic.body.course.video.src).toBe('/assets/demo.mp4');

    await adminRequest(adminCookie, 'patch', `/admin/courses/${course.id}`)
      .send({ video_mode: 'none' })
      .expect(200);
    const nonePublic = await request(app).get(v1(`/courses/${course.id}`)).expect(200);
    expect(nonePublic.body.course.video).toBeNull();
  });

  it('appends chapters and keeps numbering gaps after deletion', async () => {
    const adminCookie = await adminLogin();
    const course = await createCourse(adminCookie, { name: '章节课程' });

    const first = await adminRequest(adminCookie, 'post', `/admin/courses/${course.id}/chapters`)
      .send({ title: '第一章', body: '正文一' })
      .expect(201);
    expect(first.body.chapter.idx).toBe(1);
    const second = await adminRequest(adminCookie, 'post', `/admin/courses/${course.id}/chapters`)
      .send({ title: '第二章', body: '正文二' })
      .expect(201);
    expect(second.body.chapter.idx).toBe(2);

    await adminRequest(adminCookie, 'delete', `/admin/courses/${course.id}/chapters/1`).expect(200);

    const list = await adminRequest(adminCookie, 'get', '/admin/courses').expect(200);
    const row = (list.body.courses as { id: string; chapterDetails: { idx: number }[] }[]).find(
      (entry) => entry.id === course.id,
    );
    expect(row?.chapterDetails.map((chapter) => chapter.idx)).toEqual([2]);

    const third = await adminRequest(adminCookie, 'post', `/admin/courses/${course.id}/chapters`)
      .send({ title: '第三章', body: '正文三' })
      .expect(201);
    expect(third.body.chapter.idx).toBe(3);
  });

  it('refuses to delete a course with records and force-deletes in one transaction', async () => {
    const adminCookie = await adminLogin();
    const course = await createCourse(adminCookie, { name: '可删除课程' });

    await adminRequest(adminCookie, 'post', '/records')
      .send({
        student_id: 'S900',
        course_name: course.name,
        learning_date: '2026-11-18',
        learning_minutes: 10,
        chapters_done: 1,
        total_chapters: 3,
        quiz_score: null,
      })
      .expect(201);

    const conflict = await adminRequest(
      adminCookie,
      'delete',
      `/admin/courses/${course.id}`,
    ).expect(409);
    expect(conflict.body).toMatchObject({ ok: false, conflict: true, records: 1 });

    const forced = await adminRequest(
      adminCookie,
      'delete',
      `/admin/courses/${course.id}?force=1`,
    ).expect(200);
    expect(forced.body).toEqual({ ok: true, deletedRecords: 1 });

    await request(app).get(v1(`/courses/${course.id}`)).expect(404);
    const records = await adminRequest(adminCookie, 'get', '/records').expect(200);
    expect(records.body.total).toBe(177);
  });

  it('paginates records in learning_date DESC, student_id, id order', async () => {
    const adminCookie = await adminLogin();
    const page = await adminRequest(adminCookie, 'get', '/records?limit=5&offset=10').expect(200);
    expect(page.body).toMatchObject({ total: 177, limit: 5, offset: 10 });
    const rows = page.body.rows as {
      id: number;
      student_id: string;
      learning_date: string;
    }[];
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1]!;
      const curr = rows[i]!;
      expect(prev.learning_date >= curr.learning_date).toBe(true);
      if (prev.learning_date === curr.learning_date) {
        expect(prev.student_id <= curr.student_id).toBe(true);
        if (prev.student_id === curr.student_id) expect(prev.id < curr.id).toBe(true);
      }
    }
  });

  it('exports UTF-8 BOM + CRLF CSV, dry-runs, then imports it back', async () => {
    const adminCookie = await adminLogin();
    const exported = await adminRequest(adminCookie, 'get', '/export.csv').expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text.startsWith('﻿')).toBe(true);
    expect(exported.text).toContain('\r\n');
    expect(exported.text.slice(1).split('\r\n')[0]).toBe(SEED_CSV_HEADER);

    const dryCsv = `${SEED_CSV_HEADER}\r\nS901,生成式 AI 基础,2026-11-18,30,1,6,80\r\n`;
    const dryRun = await adminRequest(adminCookie, 'post', '/records/import?dry_run=1')
      .set('Content-Type', 'text/csv')
      .send(dryCsv)
      .expect(200);
    expect(dryRun.body).toMatchObject({ ok: true, inserted: 1, skipped: 0, total: 1 });

    const still = await adminRequest(adminCookie, 'get', '/records').expect(200);
    expect(still.body.total).toBe(177);

    const imported = await adminRequest(adminCookie, 'post', '/records/import')
      .set('Content-Type', 'text/csv')
      .send(exported.text)
      .expect(200);
    expect(imported.body).toMatchObject({ ok: true, inserted: 177, skipped: 0, total: 177 });

    const after = await adminRequest(adminCookie, 'get', '/records').expect(200);
    expect(after.body.total).toBe(177);
  });

  it('restores the fixture dataset and exposes audit rows', async () => {
    const adminCookie = await adminLogin();

    const reset = await adminRequest(adminCookie, 'post', '/admin/reset').expect(200);
    expect(reset.body).toMatchObject({ ok: true, inserted: 177 });
    const after = await adminRequest(adminCookie, 'get', '/records').expect(200);
    expect(after.body.total).toBe(177);

    const audit = await adminRequest(adminCookie, 'get', '/admin/audit?limit=5').expect(200);
    expect(audit.body).toMatchObject({ limit: 5, offset: 0 });
    expect(audit.body.total).toBeGreaterThan(0);
    expect((audit.body.rows as { id: number }[]).length).toBeLessThanOrEqual(5);
    const ids = (audit.body.rows as { id: number }[]).map((row) => row.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));

    const resetRows = await adminRequest(
      adminCookie,
      'get',
      '/admin/audit?action=data.reset',
    ).expect(200);
    expect(resetRows.body.total).toBeGreaterThanOrEqual(1);
    expect(
      (resetRows.body.rows as { action: string }[]).every((row) => row.action === 'data.reset'),
    ).toBe(true);

    const createdRows = await adminRequest(
      adminCookie,
      'get',
      '/admin/audit?action=admin.course_created',
    ).expect(200);
    expect(createdRows.body.total).toBeGreaterThanOrEqual(1);
    const first = (createdRows.body.rows as { details: Record<string, unknown> | null }[])[0];
    expect(typeof first?.details).toBe('object');

    const capped = await adminRequest(adminCookie, 'get', '/admin/audit?limit=999').expect(200);
    expect(capped.body.limit).toBe(200);
  });
});