import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  openDb,
  getAllRecords,
  getCourseMeta,
  getKnowledge,
  getChapterRows,
  getChapter,
  listRecords,
  addRecord,
  updateRecord,
  deleteRecord,
  replaceRecordsFromCsv,
  resetRecords,
  getDatasetMeta,
  listUsers,
  createUser,
  updateUser,
  getUserAuthByEmail,
  getUserById,
  touchLogin,
  markEmailVerified,
  updatePasswordHash,
  recordLoginFailure,
  resetLoginFailures,
  setPendingMfaSecret,
  enableMfa,
  disableMfa,
  consumeRecoveryCode,
  writeAudit,
  listAudit,
  createCourse,
  updateCourse,
  deleteCourse,
  addChapter,
  updateChapter,
  deleteChapter,
  ROOT
} from './src/db.js';
import { groupEnrollments, summarize, byCourse, buildDashboard, buildInsights, dataQuality, chapterStats } from './src/analytics.js';
import { toCsv } from './src/csv.js';
import { PITFALLS, CHAPTER_VIDEO_DEFAULT, CHAPTER_VIDEOS } from './src/content.js';
import {
  SESSION_COOKIE,
  parseCookies,
  getSessionUser,
  createSession,
  destroySession,
  destroyUserSessions,
  sessionCookie,
  clearSessionCookie,
  hashPassword,
  verifyPassword,
  passwordProblem,
  ensureAdminUser,
  purgeExpiredSessions,
  purgeAuthTokens,
  issueAuthToken,
  getAuthToken,
  markAuthTokenUsed
} from './src/auth.js';
import { generateTotpSecret, verifyTotp, otpauthUri, generateRecoveryCodes, hashRecoveryCode } from './src/totp.js';
import { sendMail, verificationUrl, passwordResetUrl, appBaseUrl } from './src/mailer.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const BODY_LIMIT = 2 * 1024 * 1024;
const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || 'development';
const IS_PRODUCTION = APP_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || IS_PRODUCTION;
const CSRF_COOKIE = 'aip_csrf';
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('请求体超过 2MB 限制'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

function requestContext(db, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
  return { token, user: getSessionUser(db, token) };
}

function clientUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: Boolean(row.email_verified ?? row.emailVerified),
    mfaEnabled: Boolean(row.mfa_enabled ?? row.mfaEnabled),
    active: row.active === undefined ? undefined : Boolean(row.active)
  };
}

function csrfCookie(value, { secure = false } = {}) {
  return `${CSRF_COOKIE}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=604800${
    secure ? '; Secure' : ''
  }`;
}

function csrfValid(req) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return true;
  // Non-browser API clients (curl, CI) do not send Origin and are not CSRF targets.
  if (!req.headers.origin) return true;
  const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
  const header = String(req.headers['x-csrf-token'] || '');
  if (!cookie || !header) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function auditRequest(db, req, ctx, action, { targetType = null, targetId = null, details = null, actorEmail = null } = {}) {
  try {
    writeAudit(db, {
      actorUserId: ctx.user?.id ?? null,
      actorEmail: ctx.user?.email ?? actorEmail,
      action,
      targetType,
      targetId,
      ip: clientIp(req) ?? null,
      details
    });
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

function isAccountLocked(user) {
  return Boolean(user?.locked_until && user.locked_until > Date.now());
}

async function sendVerificationEmail(db, user) {
  const { token } = issueAuthToken(db, user.id, 'verify', VERIFY_TTL_MS);
  const url = verificationUrl(token);
  await sendMail({
    to: user.email,
    subject: '验证你的邮箱 · AI Learning Portal',
    text: `你好 ${user.name}：\n\n请在 24 小时内打开以下链接验证邮箱：\n${url}\n\n如果不是你本人注册，请忽略此邮件。`
  });
  return url;
}

async function sendPasswordResetEmail(db, user) {
  const { token } = issueAuthToken(db, user.id, 'reset', RESET_TTL_MS);
  const url = passwordResetUrl(token);
  await sendMail({
    to: user.email,
    subject: '重置密码 · AI Learning Portal',
    text: `你好 ${user.name}：\n\n请在 1 小时内打开以下链接重置密码：\n${url}\n\n如果不是你本人操作，请忽略此邮件。`
  });
  return url;
}

function requireAdmin(res, user) {
  if (!user) {
    sendJson(res, 401, { error: '请先登录' });
    return false;
  }
  if (user.role !== 'admin') {
    sendJson(res, 403, { error: '需要管理员权限' });
    return false;
  }
  return true;
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === String(req.headers.host || '');
  } catch {
    return false;
  }
}

function isSecureRequest(req) {
  return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? null;
}

const authHits = new Map();
function clearRateLimit(key) {
  authHits.delete(key);
}

function rateLimited(key, max = 20, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  let bucket = authHits.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    authHits.set(key, bucket);
  }
  bucket.count += 1;
  if (authHits.size > 2000) {
    for (const [k, v] of authHits) if (v.resetAt <= now) authHits.delete(k);
  }
  return bucket.count > max;
}

function courseStatsMap(records, enrollments, courses) {
  const stats = byCourse(records, enrollments, courses.map((c) => c.name));
  return new Map(stats.map((s) => [s.course_name, s]));
}

function coursesPayload(db, query) {
  const records = getAllRecords(db);
  const enrollments = groupEnrollments(records);
  const courses = getCourseMeta(db);
  const stats = courseStatsMap(records, enrollments, courses);
  let list = courses.map((c) => ({ ...c, stats: stats.get(c.name) }));

  const q = (query.get('q') ?? '').trim().toLowerCase();
  const category = query.get('category') ?? '';
  if (q) {
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.intro.toLowerCase().includes(q) ||
        c.teacher.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
    );
  }
  if (category) list = list.filter((c) => c.category === category);

  return {
    courses: list,
    categories: [...new Set(courses.map((c) => c.category))],
    overview: summarize(records, enrollments)
  };
}

function dashboardPayload(db, courseFilter) {
  const all = getAllRecords(db);
  const records = courseFilter ? all.filter((r) => r.course_name === courseFilter) : all;
  const enrollments = groupEnrollments(records);
  const courseNames = getCourseMeta(db).map((c) => c.name);
  const data = buildDashboard(records, enrollments, courseNames);
  if (courseFilter) {
    data.byCourse = data.byCourse.filter((c) => c.course_name === courseFilter);
  }
  data.filter = courseFilter || null;
  data.courseOptions = courseNames;
  data.courseCatalog = getCourseMeta(db).map(({ id, name, color, badge }) => ({ id, name, color, badge }));
  data.dataset = getDatasetMeta(db);
  return data;
}

function insightsPayload(db) {
  const records = getAllRecords(db);
  const enrollments = groupEnrollments(records);
  const overview = summarize(records, enrollments);
  const courses = getCourseMeta(db);
  const courseStats = byCourse(records, enrollments, courses.map((c) => c.name));
  return {
    overview,
    byCourse: courseStats,
    insights: buildInsights(records, enrollments, overview, courseStats),
    pitfalls: PITFALLS,
    dataset: getDatasetMeta(db),
    quality: dataQuality(records, enrollments, overview),
    courseCatalog: courses.map(({ id, name, color, badge }) => ({ id, name, color, badge }))
  };
}

function adminCoursesPayload(db) {
  const courses = getCourseMeta(db);
  const records = getAllRecords(db);
  const enrollments = groupEnrollments(records);
  const stats = courseStatsMap(records, enrollments, courses);
  return {
    courses: courses.map((c) => ({
      ...c,
      stats: stats.get(c.name) ?? null,
      chapterDetails: getChapterRows(db, c.id)
    }))
  };
}

function apiRoute(db, req, res, url, ctx) {
  const p = url.pathname;
  const q = url.searchParams;

  /* ------------------------------ auth ------------------------------ */

  if (req.method === 'GET' && p === '/api/auth/me') {
    return sendJson(res, 200, { user: ctx.user });
  }

  if (req.method === 'POST' && p === '/api/auth/register') {
    const limitKey = `register:${clientIp(req)}`;
    if (rateLimited(limitKey)) {
      return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    }
    return readJson(req).then(async (body) => {
      const result = createUser(db, {
        name: body.name,
        email: body.email,
        password: body.password,
        role: 'learner',
        active: true,
        emailVerified: !IS_PRODUCTION
      });
      if (!result.ok) return sendJson(res, 400, { error: result.errors[0], errors: result.errors });
      const user = getUserAuthByEmail(db, result.user.email);
      clearRateLimit(limitKey);
      auditRequest(db, req, { user: null }, 'auth.register', {
        targetType: 'user',
        targetId: user.id,
        details: { email: user.email }
      });

      if (IS_PRODUCTION) {
        try {
          await sendVerificationEmail(db, user);
        } catch (err) {
          auditRequest(db, req, { user: null }, 'auth.verification_mail_failed', {
            targetType: 'user',
            targetId: user.id,
            details: { message: err.message }
          });
          return sendJson(res, 502, {
            error: '账号已创建，但验证邮件发送失败，请稍后使用“重发验证邮件”',
            code: 'MAIL_FAILED'
          });
        }
        return sendJson(res, 201, { verificationRequired: true, email: user.email });
      }

      const session = createSession(db, user.id);
      touchLogin(db, user.id);
      return sendJson(
        res,
        201,
        { user: clientUser(user) },
        { 'Set-Cookie': sessionCookie(session.token, { secure: isSecureRequest(req) }) }
      );
    });
  }

  if (req.method === 'POST' && p === '/api/auth/login') {
    const limitKey = `login:${clientIp(req)}`;
    if (rateLimited(limitKey)) {
      return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    }
    return readJson(req).then((body) => {
      const row = getUserAuthByEmail(db, body.email);
      if (!row) {
        auditRequest(db, req, { user: null }, 'auth.login_failed', { actorEmail: body.email });
        return sendJson(res, 401, { error: '邮箱或密码错误' });
      }
      if (!row.active) {
        auditRequest(db, req, { user: null }, 'auth.login_inactive', {
          actorEmail: row.email,
          targetType: 'user',
          targetId: row.id
        });
        return sendJson(res, 401, { error: '邮箱或密码错误' });
      }
      if (isAccountLocked(row)) {
        auditRequest(db, req, { user: null }, 'auth.login_locked', {
          actorEmail: row.email,
          targetType: 'user',
          targetId: row.id
        });
        return sendJson(res, 423, { error: '账号已临时锁定，请 15 分钟后再试' });
      }
      if (!verifyPassword(body.password, row.password_hash)) {
        const lockedUntil = recordLoginFailure(db, row.id);
        auditRequest(db, req, { user: null }, 'auth.login_failed', {
          actorEmail: row.email,
          targetType: 'user',
          targetId: row.id,
          details: lockedUntil ? { lockedUntil } : null
        });
        return sendJson(res, lockedUntil ? 423 : 401, {
          error: lockedUntil ? '账号已临时锁定，请 15 分钟后再试' : '邮箱或密码错误'
        });
      }
      if (!row.email_verified) {
        auditRequest(db, req, { user: null }, 'auth.login_unverified', {
          actorEmail: row.email,
          targetType: 'user',
          targetId: row.id
        });
        return sendJson(res, 403, { code: 'EMAIL_UNVERIFIED', error: '请先验证邮箱后再登录' });
      }
      resetLoginFailures(db, row.id);
      clearRateLimit(limitKey);

      if (row.mfa_enabled) {
        const challenge = issueAuthToken(db, row.id, 'mfa', MFA_CHALLENGE_TTL_MS);
        auditRequest(db, req, { user: null }, 'auth.mfa_challenge', {
          actorEmail: row.email,
          targetType: 'user',
          targetId: row.id
        });
        return sendJson(res, 200, { mfaRequired: true, challengeToken: challenge.token });
      }

      const session = createSession(db, row.id);
      touchLogin(db, row.id);
      auditRequest(db, req, { user: null }, 'auth.login', {
        actorEmail: row.email,
        targetType: 'user',
        targetId: row.id
      });
      return sendJson(
        res,
        200,
        { user: clientUser(row) },
        { 'Set-Cookie': sessionCookie(session.token, { secure: isSecureRequest(req) }) }
      );
    });
  }

  if (req.method === 'POST' && p === '/api/auth/mfa') {
    const limitKey = `mfa:${clientIp(req)}`;
    if (rateLimited(limitKey)) return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    return readJson(req).then((body) => {
      const tokenRow = getAuthToken(db, body.challengeToken, 'mfa');
      if (!tokenRow) return sendJson(res, 401, { error: '验证已过期，请重新登录' });
      const user = getUserById(db, tokenRow.user_id);
      if (!user || !user.active) return sendJson(res, 401, { error: '账号不可用' });
      if (isAccountLocked(user)) {
        return sendJson(res, 423, { error: '账号已临时锁定，请 15 分钟后再试' });
      }
      const ok =
        (user.mfa_secret && verifyTotp(user.mfa_secret, body.code)) ||
        consumeRecoveryCode(db, user.id, hashRecoveryCode(body.code));
      if (!ok) {
        const lockedUntil = recordLoginFailure(db, user.id);
        auditRequest(db, req, { user: null }, 'auth.mfa_failed', {
          actorEmail: user.email,
          targetType: 'user',
          targetId: user.id
        });
        return sendJson(res, lockedUntil ? 423 : 401, {
          error: lockedUntil ? '账号已临时锁定，请 15 分钟后再试' : '验证码不正确'
        });
      }
      markAuthTokenUsed(db, body.challengeToken);
      resetLoginFailures(db, user.id);
      clearRateLimit(limitKey);
      const session = createSession(db, user.id);
      touchLogin(db, user.id);
      auditRequest(db, req, { user: null }, 'auth.login_mfa', {
        actorEmail: user.email,
        targetType: 'user',
        targetId: user.id
      });
      return sendJson(
        res,
        200,
        { user: clientUser(user) },
        { 'Set-Cookie': sessionCookie(session.token, { secure: isSecureRequest(req) }) }
      );
    });
  }

  if (req.method === 'POST' && p === '/api/auth/verify-email') {
    const limitKey = `verify:${clientIp(req)}`;
    if (rateLimited(limitKey)) return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    return readJson(req).then((body) => {
      const tokenRow = getAuthToken(db, body.token, 'verify');
      if (!tokenRow) return sendJson(res, 400, { error: '验证链接无效或已过期' });
      const user = getUserById(db, tokenRow.user_id);
      if (!user || !user.active) return sendJson(res, 400, { error: '账号不可用' });
      markEmailVerified(db, user.id);
      markAuthTokenUsed(db, body.token);
      resetLoginFailures(db, user.id);
      const fresh = getUserById(db, user.id);
      auditRequest(db, req, { user: null }, 'auth.email_verified', {
        actorEmail: user.email,
        targetType: 'user',
        targetId: user.id
      });
      if (fresh.mfa_enabled) {
        const challenge = issueAuthToken(db, user.id, 'mfa', MFA_CHALLENGE_TTL_MS);
        return sendJson(res, 200, {
          user: clientUser(fresh),
          mfaRequired: true,
          challengeToken: challenge.token
        });
      }
      const session = createSession(db, user.id);
      touchLogin(db, user.id);
      return sendJson(
        res,
        200,
        { user: clientUser(fresh) },
        { 'Set-Cookie': sessionCookie(session.token, { secure: isSecureRequest(req) }) }
      );
    });
  }

  if (req.method === 'POST' && p === '/api/auth/resend-verification') {
    const limitKey = `resend-verify:${clientIp(req)}`;
    if (rateLimited(limitKey)) return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    return readJson(req).then(async (body) => {
      const user = getUserAuthByEmail(db, body.email);
      if (user && user.active && !user.email_verified) {
        try {
          await sendVerificationEmail(db, user);
          auditRequest(db, req, { user: null }, 'auth.verification_resent', {
            actorEmail: user.email,
            targetType: 'user',
            targetId: user.id
          });
        } catch (err) {
          console.error('[mail] verification resend failed:', err.message);
        }
      }
      return sendJson(res, 200, { ok: true, message: '如果邮箱存在，验证邮件将很快送达' });
    });
  }

  if (req.method === 'POST' && p === '/api/auth/forgot-password') {
    const limitKey = `forgot:${clientIp(req)}`;
    if (rateLimited(limitKey)) return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    return readJson(req).then(async (body) => {
      const user = getUserAuthByEmail(db, body.email);
      if (user && user.active) {
        try {
          await sendPasswordResetEmail(db, user);
          auditRequest(db, req, { user: null }, 'auth.password_reset_requested', {
            actorEmail: user.email,
            targetType: 'user',
            targetId: user.id
          });
        } catch (err) {
          console.error('[mail] password reset failed:', err.message);
        }
      }
      return sendJson(res, 200, { ok: true, message: '如果邮箱存在，重置邮件将很快送达' });
    });
  }

  if (req.method === 'POST' && p === '/api/auth/reset-password') {
    const limitKey = `reset:${clientIp(req)}`;
    if (rateLimited(limitKey)) return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    return readJson(req).then((body) => {
      const tokenRow = getAuthToken(db, body.token, 'reset');
      if (!tokenRow) return sendJson(res, 400, { error: '重置链接无效或已过期' });
      const problem = passwordProblem(body.password);
      if (problem) return sendJson(res, 400, { error: problem });
      const user = getUserById(db, tokenRow.user_id);
      if (!user || !user.active) return sendJson(res, 400, { error: '账号不可用' });
      updatePasswordHash(db, user.id, hashPassword(body.password));
      markEmailVerified(db, user.id);
      destroyUserSessions(db, user.id);
      markAuthTokenUsed(db, body.token);
      resetLoginFailures(db, user.id);
      auditRequest(db, req, { user: null }, 'auth.password_reset', {
        actorEmail: user.email,
        targetType: 'user',
        targetId: user.id
      });
      return sendJson(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && p === '/api/auth/change-password') {
    if (!ctx.user) return sendJson(res, 401, { error: '请先登录' });
    if (rateLimited(`account-password:${ctx.user.id}`, 10)) {
      return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    }
    return readJson(req).then((body) => {
      const user = getUserById(db, ctx.user.id);
      if (!user || !verifyPassword(body.currentPassword, user.password_hash)) {
        return sendJson(res, 400, { error: '当前密码不正确' });
      }
      const problem = passwordProblem(body.newPassword);
      if (problem) return sendJson(res, 400, { error: problem });
      updatePasswordHash(db, user.id, hashPassword(body.newPassword));
      destroyUserSessions(db, user.id, { exceptToken: ctx.token });
      auditRequest(db, req, ctx, 'auth.password_changed', {
        targetType: 'user',
        targetId: user.id
      });
      return sendJson(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && p === '/api/auth/mfa/setup') {
    if (!ctx.user) return sendJson(res, 401, { error: '请先登录' });
    const user = getUserById(db, ctx.user.id);
    if (!user) return sendJson(res, 401, { error: '请先登录' });
    if (user.mfa_enabled) return sendJson(res, 409, { error: 'MFA 已启用' });
    const secret = generateTotpSecret();
    setPendingMfaSecret(db, user.id, secret);
    auditRequest(db, req, ctx, 'auth.mfa_setup_started', { targetType: 'user', targetId: user.id });
    return sendJson(res, 200, {
      secret,
      otpauthUri: otpauthUri(user.email, secret),
      message: '在认证器中添加该密钥，然后输入 6 位验证码完成启用'
    });
  }

  if (req.method === 'POST' && p === '/api/auth/mfa/enable') {
    if (!ctx.user) return sendJson(res, 401, { error: '请先登录' });
    if (rateLimited(`mfa-enable:${ctx.user.id}`, 10)) {
      return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    }
    return readJson(req).then((body) => {
      const user = getUserById(db, ctx.user.id);
      if (!user?.mfa_secret) return sendJson(res, 400, { error: '请先获取 MFA 密钥' });
      if (!verifyTotp(user.mfa_secret, body.code)) return sendJson(res, 400, { error: '验证码不正确' });
      const codes = generateRecoveryCodes(8);
      enableMfa(db, user.id, codes.map(hashRecoveryCode));
      // Password-only sessions created before MFA was enabled must be re-authenticated.
      destroyUserSessions(db, user.id, { exceptToken: ctx.token });
      auditRequest(db, req, ctx, 'auth.mfa_enabled', { targetType: 'user', targetId: user.id });
      return sendJson(res, 200, { recoveryCodes: codes });
    });
  }

  if (req.method === 'POST' && p === '/api/auth/mfa/disable') {
    if (!ctx.user) return sendJson(res, 401, { error: '请先登录' });
    if (rateLimited(`mfa-disable:${ctx.user.id}`, 10)) {
      return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' });
    }
    return readJson(req).then((body) => {
      const user = getUserById(db, ctx.user.id);
      if (!user?.mfa_enabled) return sendJson(res, 400, { error: 'MFA 未启用' });
      if (!verifyPassword(body.password, user.password_hash)) {
        return sendJson(res, 400, { error: '密码不正确' });
      }
      disableMfa(db, user.id);
      auditRequest(db, req, ctx, 'auth.mfa_disabled', { targetType: 'user', targetId: user.id });
      return sendJson(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && p === '/api/auth/logout') {
    if (ctx.user) auditRequest(db, req, ctx, 'auth.logout', { targetType: 'user', targetId: ctx.user.id });
    destroySession(db, ctx.token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie({ secure: isSecureRequest(req) }) });
  }

  /* --------------------------- admin gate --------------------------- */

  if (p.startsWith('/api/admin/') && !requireAdmin(res, ctx.user)) return;

  if (req.method === 'GET' && p === '/api/admin/audit') {
    return sendJson(res, 200, listAudit(db, {
      limit: q.get('limit') || 50,
      offset: q.get('offset') || 0,
      action: q.get('action') || ''
    }));
  }

  if (req.method === 'GET' && p === '/api/admin/users') {
    return sendJson(res, 200, { users: listUsers(db) });
  }

  if (req.method === 'POST' && p === '/api/admin/users') {
    return readJson(req).then((body) => {
      const result = createUser(db, {
        name: body.name,
        email: body.email,
        password: body.password,
        role: body.role === 'admin' ? 'admin' : 'learner',
        active: body.active !== false
      });
      if (!result.ok) return sendJson(res, 400, { error: result.errors[0], errors: result.errors });
      auditRequest(db, req, ctx, 'admin.user_created', {
        targetType: 'user',
        targetId: result.user.id,
        details: { email: result.user.email, role: result.user.role }
      });
      return sendJson(res, 201, result);
    });
  }

  const adminUserMatch = p.match(/^\/api\/admin\/users\/(\d+)$/);
  if (adminUserMatch && req.method === 'PATCH') {
    return readJson(req).then((body) => {
      const targetId = Number(adminUserMatch[1]);
      const result = updateUser(db, targetId, body, { actingUserId: ctx.user.id });
      if (!result.ok) return sendJson(res, result.notFound ? 404 : 400, result);
      if (body.password !== undefined) {
        destroyUserSessions(db, targetId, {
          exceptToken: targetId === ctx.user.id ? ctx.token : null
        });
      }
      auditRequest(db, req, ctx, 'admin.user_updated', {
        targetType: 'user',
        targetId,
        details: {
          fields: Object.keys(body).filter((k) => !['password'].includes(k)),
          passwordReset: body.password !== undefined,
          unlock: body.unlock === true,
          resetMfa: body.resetMfa === true
        }
      });
      return sendJson(res, 200, result);
    });
  }

  if (req.method === 'GET' && p === '/api/admin/courses') {
    return sendJson(res, 200, adminCoursesPayload(db));
  }

  if (req.method === 'POST' && p === '/api/admin/courses') {
    return readJson(req).then((body) => {
      const result = createCourse(db, body);
      if (!result.ok) return sendJson(res, 400, { error: result.errors[0], errors: result.errors });
      auditRequest(db, req, ctx, 'admin.course_created', {
        targetType: 'course',
        targetId: result.course.id,
        details: { name: result.course.name }
      });
      return sendJson(res, 201, result);
    });
  }

  const adminCourseMatch = p.match(/^\/api\/admin\/courses\/([^/]+)$/);
  if (adminCourseMatch && req.method === 'PATCH') {
    return readJson(req).then((body) => {
      const result = updateCourse(db, decodeURIComponent(adminCourseMatch[1]), body);
      if (!result.ok) return sendJson(res, result.notFound ? 404 : 400, result);
      auditRequest(db, req, ctx, 'admin.course_updated', {
        targetType: 'course',
        targetId: result.course.id,
        details: { fields: Object.keys(body) }
      });
      return sendJson(res, 200, result);
    });
  }
  if (adminCourseMatch && req.method === 'DELETE') {
    const courseId = decodeURIComponent(adminCourseMatch[1]);
    const result = deleteCourse(db, courseId, { force: q.get('force') === '1' });
    if (!result.ok) return sendJson(res, result.notFound ? 404 : 409, result);
    auditRequest(db, req, ctx, 'admin.course_deleted', {
      targetType: 'course',
      targetId: courseId,
      details: { force: q.get('force') === '1', deletedRecords: result.deletedRecords }
    });
    return sendJson(res, 200, result);
  }

  const adminChapterMatch = p.match(/^\/api\/admin\/courses\/([^/]+)\/chapters\/(\d+)$/);
  if (adminChapterMatch && req.method === 'PATCH') {
    return readJson(req).then((body) => {
      const result = updateChapter(
        db,
        decodeURIComponent(adminChapterMatch[1]),
        Number(adminChapterMatch[2]),
        body
      );
      if (!result.ok) return sendJson(res, result.notFound ? 404 : 400, result);
      auditRequest(db, req, ctx, 'admin.chapter_updated', {
        targetType: 'chapter',
        targetId: `${decodeURIComponent(adminChapterMatch[1])}-${adminChapterMatch[2]}`,
        details: { fields: Object.keys(body) }
      });
      return sendJson(res, 200, result);
    });
  }
  if (adminChapterMatch && req.method === 'DELETE') {
    const courseId = decodeURIComponent(adminChapterMatch[1]);
    const chapterIdx = Number(adminChapterMatch[2]);
    const result = deleteChapter(db, courseId, chapterIdx);
    if (!result.ok) return sendJson(res, result.notFound ? 404 : 400, result);
    auditRequest(db, req, ctx, 'admin.chapter_deleted', {
      targetType: 'chapter',
      targetId: `${courseId}-${chapterIdx}`
    });
    return sendJson(res, 200, result);
  }

  const adminChaptersMatch = p.match(/^\/api\/admin\/courses\/([^/]+)\/chapters$/);
  if (adminChaptersMatch && req.method === 'POST') {
    return readJson(req).then((body) => {
      const courseId = decodeURIComponent(adminChaptersMatch[1]);
      const result = addChapter(db, courseId, body);
      if (!result.ok) return sendJson(res, result.notFound ? 404 : 400, result);
      auditRequest(db, req, ctx, 'admin.chapter_created', {
        targetType: 'chapter',
        targetId: `${courseId}-${result.chapter.idx}`,
        details: { title: result.chapter.title }
      });
      return sendJson(res, 201, result);
    });
  }

  if (req.method === 'GET' && p === '/api/meta') {
    const records = getAllRecords(db);
    return sendJson(res, 200, {
      overview: summarize(records, groupEnrollments(records)),
      dataset: getDatasetMeta(db),
      courses: getCourseMeta(db).map(({ id, name, category }) => ({ id, name, category }))
    });
  }

  if (req.method === 'GET' && p === '/api/courses') {
    return sendJson(res, 200, coursesPayload(db, q));
  }

  const courseMatch = p.match(/^\/api\/courses\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && courseMatch) {
    const courses = getCourseMeta(db);
    const course = courses.find((c) => c.id === courseMatch[1]) ?? courses.find((c) => c.name === courseMatch[1]);
    if (!course) return sendJson(res, 404, { error: '课程不存在' });
    const records = getAllRecords(db);
    const enrollments = groupEnrollments(records);
    const stats = byCourse(records, enrollments, [course.name])[0];
    const chapters = getChapterRows(db, course.id);
    return sendJson(res, 200, { course, stats, chapterStats: chapterStats(enrollments, course.name, chapters) });
  }

  const chapterMatch = p.match(/^\/api\/chapters\/([^/]+)\/(\d+)$/);
  if (req.method === 'GET' && chapterMatch) {
    const key = decodeURIComponent(chapterMatch[1]);
    const courses = getCourseMeta(db);
    const course = courses.find((c) => c.id === key) ?? courses.find((c) => c.name === key);
    if (!course) return sendJson(res, 404, { error: '课程不存在' });
    const idx = Number(chapterMatch[2]);
    const rows = getChapterRows(db, course.id);
    const chapter = getChapter(db, course.id, idx);
    if (!chapter) return sendJson(res, 404, { error: '章节不存在' });

    const records = getAllRecords(db);
    const enrollments = groupEnrollments(records);
    const allChapterStats = chapterStats(enrollments, course.name, rows);
    const currentStats = allChapterStats.find((s) => s.idx === idx) ?? null;
    const knowledge = getKnowledge(db, course.id);
    const relatedQuiz = (knowledge?.quiz ?? []).filter((q) => {
      const m = String(q.source || '').match(/第\s*(\d+)\s*章/);
      return m && Number(m[1]) === idx;
    });

    const chapterVideo = CHAPTER_VIDEOS[`${course.id}-${idx}`] ?? CHAPTER_VIDEO_DEFAULT;

    return sendJson(res, 200, {
      course: {
        id: course.id,
        name: course.name,
        color: course.color,
        badge: course.badge,
        chapters: course.chapters,
        video: course.video
      },
      chapter: { ...chapter, video: chapterVideo },
      stats: currentStats,
      chapterStats: allChapterStats,
      relatedQuiz,
      prev: rows.find((r) => r.idx === idx - 1) ?? null,
      next: rows.find((r) => r.idx === idx + 1) ?? null
    });
  }

  const knowledgeMatch = p.match(/^\/api\/knowledge\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && knowledgeMatch) {
    const course = getCourseMeta(db).find((c) => c.id === knowledgeMatch[1]);
    if (!course) return sendJson(res, 404, { error: '课程不存在' });
    const knowledge = getKnowledge(db, course.id);
    return sendJson(res, 200, {
      course: { id: course.id, name: course.name, chapters: course.chapters, color: course.color, badge: course.badge },
      knowledge: knowledge ?? null
    });
  }

  if (req.method === 'GET' && p === '/api/dashboard') {
    return sendJson(res, 200, dashboardPayload(db, q.get('course') || ''));
  }

  if (req.method === 'GET' && p === '/api/insights') {
    return sendJson(res, 200, insightsPayload(db));
  }

  if (req.method === 'GET' && p === '/api/records') {
    if (!requireAdmin(res, ctx.user)) return;
    return sendJson(
      res,
      200,
      listRecords(db, {
        course: q.get('course') || '',
        student: q.get('student') || '',
        q: q.get('q') || '',
        limit: q.get('limit') || 20,
        offset: q.get('offset') || 0
      })
    );
  }

  if (req.method === 'POST' && p === '/api/records') {
    if (!requireAdmin(res, ctx.user)) return;
    return readJson(req).then((body) => {
      const result = addRecord(db, body);
      if (!result.ok) return sendJson(res, 400, result);
      auditRequest(db, req, ctx, 'data.record_created', {
        targetType: 'record',
        targetId: result.record.id,
        details: { studentId: result.record.student_id, course: result.record.course_name }
      });
      return sendJson(res, 201, { ...result, dataset: getDatasetMeta(db) });
    });
  }

  const recordMatch = p.match(/^\/api\/records\/(\d+)$/);
  if (recordMatch && req.method === 'PATCH') {
    if (!requireAdmin(res, ctx.user)) return;
    const id = Number(recordMatch[1]);
    return readJson(req).then((body) => {
      if (!body || Object.keys(body).length === 0) return sendJson(res, 400, { error: '没有需要更新的字段' });
      const result = updateRecord(db, id, body);
      if (!result.ok) return sendJson(res, result.notFound ? 404 : 400, result);
      auditRequest(db, req, ctx, 'data.record_updated', {
        targetType: 'record',
        targetId: id,
        details: { fields: Object.keys(body) }
      });
      return sendJson(res, 200, { ...result, dataset: getDatasetMeta(db) });
    });
  }

  if (recordMatch && req.method === 'DELETE') {
    if (!requireAdmin(res, ctx.user)) return;
    const id = Number(recordMatch[1]);
    const result = deleteRecord(db, id);
    if (!result.ok) return sendJson(res, 404, result);
    auditRequest(db, req, ctx, 'data.record_deleted', { targetType: 'record', targetId: id });
    return sendJson(res, 200, { ok: true, dataset: getDatasetMeta(db) });
  }

  if (req.method === 'POST' && p === '/api/records/import') {
    if (!requireAdmin(res, ctx.user)) return;
    const contentType = String(req.headers['content-type'] || '');
    return readBody(req).then((text) => {
      let csv = text;
      if (contentType.includes('application/json')) {
        try {
          csv = JSON.parse(text).csv;
        } catch {
          return sendJson(res, 400, { error: '请求体不是合法 JSON' });
        }
      }
      if (!csv || typeof csv !== 'string') return sendJson(res, 400, { error: '缺少 CSV 内容' });
      const result = replaceRecordsFromCsv(db, csv, { source: 'csv-import' });
      auditRequest(db, req, ctx, 'data.csv_imported', {
        targetType: 'dataset',
        details: { inserted: result.inserted, skipped: result.skipped }
      });
      return sendJson(res, result.ok ? 200 : 400, { ...result, dataset: getDatasetMeta(db) });
    });
  }

  if (req.method === 'POST' && p === '/api/admin/reset') {
    if (IS_PRODUCTION && process.env.ALLOW_DEMO_RESET !== '1') {
      return sendJson(res, 403, { error: '生产环境已禁用“恢复示例数据”；如需演示请显式设置 ALLOW_DEMO_RESET=1' });
    }
    const result = resetRecords(db);
    auditRequest(db, req, ctx, 'data.reset', {
      targetType: 'dataset',
      details: { inserted: result.inserted, skipped: result.skipped }
    });
    return sendJson(res, result.ok ? 200 : 500, { ...result, dataset: getDatasetMeta(db) });
  }

  if (req.method === 'GET' && p === '/api/export.csv') {
    if (!requireAdmin(res, ctx.user)) return;
    const records = getAllRecords(db);
    const csv = toCsv(records);
    auditRequest(db, req, ctx, 'data.csv_exported', {
      targetType: 'dataset',
      details: { records: records.length }
    });
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="learning_records.csv"',
      'Content-Length': Buffer.byteLength(csv),
      'Cache-Control': 'no-store'
    });
    return res.end(csv);
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  let rel = pathname === '/' ? '/index.html' : pathname;
  const abs = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Forbidden');

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    // 未知的无扩展名路径回落到 SPA 入口
    if (!path.extname(pathname)) {
      const index = path.join(PUBLIC_DIR, 'index.html');
      return streamFile(req, res, index);
    }
    return sendText(res, 404, 'Not found');
  }
  return streamFile(req, res, abs);
}

/** 静态文件，支持单段 Range 请求（视频拖动进度条需要 206）。 */
function streamFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(file);
  const size = stat.size;
  const baseHeaders = {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'Accept-Ranges': 'bytes'
  };

  // Issue a readable CSRF double-submit cookie when the SPA shell is served.
  if (path.basename(file) === 'index.html') {
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies[CSRF_COOKIE]) {
      baseHeaders['Set-Cookie'] = csrfCookie(crypto.randomBytes(24).toString('base64url'), {
        secure: isSecureRequest(req)
      });
    }
  }

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
      let end = m[2] === '' ? size - 1 : Number(m[2]);
      if (m[1] === '' && m[2] !== '') {
        start = Math.max(0, size - Number(m[2]));
        end = size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= size) {
        res.writeHead(416, { ...SECURITY_HEADERS, 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      end = Math.min(end, size - 1);
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

export function createServer(db) {
  return http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendText(res, 400, 'Bad request');
    }

    if (url.pathname.startsWith('/api/')) {
      const mutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
      if (mutating && !isSameOrigin(req)) {
        return sendJson(res, 403, { error: '跨站请求被拒绝' });
      }
      if (mutating && !csrfValid(req)) {
        return sendJson(res, 403, { error: 'CSRF 校验失败，请刷新页面后重试' });
      }
      Promise.resolve()
        .then(() => apiRoute(db, req, res, url, requestContext(db, req)))
        .catch((err) => {
          const status = err.status || 500;
          if (status === 500) console.error('[api]', err);
          if (!res.headersSent) sendJson(res, status, { error: err.message || '服务器内部错误' });
        });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) {
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, uptime: process.uptime() });
      try {
        db.prepare('SELECT 1 AS ok').get();
        return sendJson(res, 200, { ok: true });
      } catch {
        return sendJson(res, 503, { ok: false });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method not allowed');
    }
    serveStatic(req, res, url);
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (IS_PRODUCTION) {
    if (!process.env.PUBLIC_BASE_URL) throw new Error('生产环境必须设置 PUBLIC_BASE_URL（用于验证/重置邮件链接）');
    if (!process.env.MAIL_WEBHOOK_URL) throw new Error('生产环境必须设置 MAIL_WEBHOOK_URL（邮件发送网关）');
  }
  const db = openDb();
  const admin = ensureAdminUser(db);
  purgeExpiredSessions(db);
  purgeAuthTokens(db);
  if (admin.created) {
    console.log(`\n  [bootstrap] 已创建管理员账号：${admin.email}`);
    if (admin.generated && !IS_PRODUCTION) {
      console.log(`  [bootstrap] 初始密码：${admin.password}`);
      console.log(`  [bootstrap] 请登录后立即修改密码，或设置 ADMIN_EMAIL / ADMIN_PASSWORD 后重建数据库。\n`);
    } else {
      console.log('  [bootstrap] 密码来自 ADMIN_PASSWORD。\n');
    }
  }
  console.log(`  运行环境：${APP_ENV}${IS_PRODUCTION ? '（演示学习记录不会自动导入）' : ''}`);
  console.log(`  站点地址：${appBaseUrl()}`);
  const server = createServer(db);
  server.listen(PORT, HOST, () => {
    const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`\n  AI Learning Portal · 开源演示`);
    console.log(`  ▶ http://${shownHost}:${PORT}`);
    console.log(`  数据库：${process.env.PORTAL_DB || path.join(ROOT, 'data', 'portal.db')}`);
    console.log(`  仅监听 ${HOST}${HOST === '0.0.0.0' ? '（局域网可访问，注意仅使用模拟数据）' : '（本机访问）'}\n`);
  });

  const shutdown = () => {
    server.close(() => {
      try {
        db.close();
      } catch {}
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}