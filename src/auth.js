import crypto from 'node:crypto';

export const SESSION_COOKIE = 'aip_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const SCRYPT_KEYLEN = 64;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isEmail(email) {
  const s = normalizeEmail(email);
  return s.length >= 5 && s.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function passwordProblem(password) {
  const s = String(password ?? '');
  if (s.length < 8) return '密码至少需要 8 个字符';
  if (s.length > 200) return '密码过长';
  return null;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const actual = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sessionId(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions(id, user_id, expires_at) VALUES(?, ?, ?)').run(sessionId(token), userId, expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(db, token) {
  if (!token) return null;
  const id = sessionId(token);
  const row = db
    .prepare(
      `SELECT s.expires_at, u.id, u.email, u.name, u.role, u.active, u.email_verified, u.mfa_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(id);
  if (!row) return null;
  if (row.expires_at < Date.now() || !row.active) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: Boolean(row.email_verified),
    mfaEnabled: Boolean(row.mfa_enabled)
  };
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId(token));
}

export function purgeExpiredSessions(db) {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return Number(result.changes);
}

/** Revoke a user's sessions, optionally keeping the current session. */
export function destroyUserSessions(db, userId, { exceptToken = null } = {}) {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, sessionId(exceptToken));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

/* ------------------------- one-time auth tokens ------------------------- */

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Issue a single-use token (verify email, reset password, MFA challenge). */
export function issueAuthToken(db, userId, type, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = tokenHash(token);
  const expiresAt = Date.now() + ttlMs;
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND type = ? AND used_at IS NULL').run(userId, type);
  db.prepare('INSERT INTO auth_tokens(id, user_id, type, expires_at) VALUES(?, ?, ?, ?)').run(
    id,
    userId,
    type,
    expiresAt
  );
  return { token, expiresAt };
}

export function getAuthToken(db, token, type) {
  if (!token) return null;
  return (
    db
      .prepare(
        'SELECT id, user_id, type, expires_at FROM auth_tokens WHERE id = ? AND type = ? AND used_at IS NULL'
      )
      .get(tokenHash(token), type) ?? null
  );
}

export function markAuthTokenUsed(db, token) {
  if (!token) return;
  db.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?").run(tokenHash(token));
}

export function purgeAuthTokens(db) {
  const now = Date.now();
  db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').run(now);
  db.prepare("DELETE FROM auth_tokens WHERE used_at IS NOT NULL AND used_at < datetime('now', '-1 day')").run();
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

export function sessionCookie(token, { secure = false } = {}) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${
    secure ? '; Secure' : ''
  }`;
}

export function clearSessionCookie({ secure = false } = {}) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/**
 * Bootstrap one admin account when the users table has no active admin.
 * Set ADMIN_EMAIL / ADMIN_PASSWORD for a predictable account; otherwise a
 * random password is generated and printed once by the caller.
 */
export function ensureAdminUser(db) {
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
  if (admins > 0) return { created: false };

  const email = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@local.test');
  if (!isEmail(email)) throw new Error('ADMIN_EMAIL 不是合法邮箱');
  if ((process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') && !process.env.ADMIN_PASSWORD) {
    throw new Error('生产环境必须设置 ADMIN_PASSWORD（至少 8 个字符）');
  }
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const problem = passwordProblem(password);
  if (problem) throw new Error(`ADMIN_PASSWORD 不合规：${problem}`);
  const hash = hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', active = 1, password_hash = ? WHERE id = ?").run(hash, existing.id);
  } else {
    db.prepare("INSERT INTO users(email, name, password_hash, role, active) VALUES(?, 'Administrator', ?, 'admin', 1)").run(
      email,
      hash
    );
  }

  return { created: true, email, password, generated };
}

