import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { COURSES, KNOWLEDGE } from './content.js';
import { hashPassword, isEmail, normalizeEmail, passwordProblem } from './auth.js';
import { parseCsv } from './csv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DB_PATH = process.env.PORTAL_DB || path.join(DATA_DIR, 'portal.db');
const SEED_CSV = path.join(DATA_DIR, 'learning_records.csv');
const FALLBACK_CSV = path.resolve(ROOT, '..', 'learning_records.csv');
const LECTURE_DIR = path.join(DATA_DIR, 'lectures');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    teacher TEXT NOT NULL,
    level TEXT NOT NULL,
    badge TEXT,
    color TEXT,
    intro TEXT,
    chapters_json TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    course_name TEXT NOT NULL,
    learning_date TEXT NOT NULL,
    learning_minutes INTEGER NOT NULL,
    chapters_done INTEGER NOT NULL,
    total_chapters INTEGER NOT NULL,
    quiz_score REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS knowledge (
    course_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chapters (
    course_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (course_id, idx)
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'learner' CHECK(role IN ('admin', 'learner')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE INDEX IF NOT EXISTS idx_records_course ON records(course_name);
  CREATE INDEX IF NOT EXISTS idx_records_student ON records(student_id);
  CREATE INDEX IF NOT EXISTS idx_records_date ON records(learning_date);
`;

function readSeedCsv() {
  const file = fs.existsSync(SEED_CSV) ? SEED_CSV : FALLBACK_CSV;
  if (!fs.existsSync(file)) throw new Error(`找不到种子 CSV：${SEED_CSV}`);
  return { text: fs.readFileSync(file, 'utf8'), file };
}

function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value)
  );
}

function getMetaValue(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

/** 从讲义原文拆出章节：标题行形如“第 3 章 数据清洗”。 */
function parseLecture(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const chapters = [];
  let current = null;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const m = line.trim().match(/^第\s*(\d+)\s*章\s*(.+)$/);
    if (m) {
      if (current) chapters.push(current);
      current = { idx: Number(m[1]), title: m[2].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) chapters.push(current);
  return chapters
    .map((c) => ({ idx: c.idx, title: c.title, body: c.body.join('\n').trim() }))
    .filter((c) => c.body.length > 0)
    .sort((a, b) => a.idx - b.idx);
}

/**
 * 为首批课程导入讲义章节。已有章节的课程不会覆盖，管理员编辑因此可以保留。
 * 后台新建的课程没有讲义文件，跳过即可。
 */
export function syncChapters(db) {
  for (const course of COURSES) {
    if (!course.lectureFile) continue;
    const seededKey = `chapters_seeded_${course.id}`;
    if (getMetaValue(db, seededKey) === '1') continue;
    const existing = db.prepare('SELECT COUNT(*) AS n FROM chapters WHERE course_id = ?').get(course.id).n;
    if (existing > 0) {
      setMeta(db, seededKey, '1');
      continue;
    }

    const file = path.join(LECTURE_DIR, course.lectureFile);
    if (!fs.existsSync(file)) {
      console.warn(`[db] 缺少课程讲义，跳过章节导入：${file}`);
      continue;
    }
    const parsed = parseLecture(fs.readFileSync(file, 'utf8'));
    if (parsed.length === 0) {
      console.warn(`[db] 讲义中未找到章节，跳过：${file}`);
      continue;
    }
    if (course.chapters && parsed.length !== course.chapters.length) {
      console.warn(`[db] ${course.name} 讲义章节数 ${parsed.length} 与课程目录 ${course.chapters.length} 不一致`);
    }
    const stmt = db.prepare('INSERT INTO chapters(course_id, idx, title, body) VALUES(?, ?, ?, ?)');
    for (const ch of parsed) stmt.run(course.id, ch.idx, ch.title, ch.body);
    setMeta(db, seededKey, '1');
  }
}

/** 仅在课程表为空时导入初始课程和知识内容。之后数据库是唯一事实来源。 */
export function syncCatalog(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM courses').get().n;
  if (count === 0) {
    const courseStmt = db.prepare(`
      INSERT INTO courses(id, name, category, teacher, level, badge, color, intro, chapters_json, sort_order)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    COURSES.forEach((c, i) => {
      courseStmt.run(
        c.id,
        c.name,
        c.category,
        c.teacher,
        c.level,
        c.badge ?? '',
        c.color ?? '#2F78C4',
        c.intro ?? '',
        JSON.stringify(c.chapters),
        i
      );
    });
  }

  const knowledgeStmt = db.prepare(
    'INSERT OR IGNORE INTO knowledge(course_id, payload_json) VALUES(?, ?)'
  );
  for (const c of COURSES) {
    if (KNOWLEDGE[c.id]) knowledgeStmt.run(c.id, JSON.stringify(KNOWLEDGE[c.id]));
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateRow(raw, courseNames) {
  const errors = [];
  const row = {
    student_id: String(raw.student_id ?? '').trim(),
    course_name: String(raw.course_name ?? '').trim(),
    learning_date: String(raw.learning_date ?? '').trim(),
    learning_minutes: Number(raw.learning_minutes),
    chapters_done: Number(raw.chapters_done),
    total_chapters: Number(raw.total_chapters),
    quiz_score: raw.quiz_score === null || raw.quiz_score === undefined || String(raw.quiz_score).trim() === '' ? null : Number(raw.quiz_score)
  };

  if (!row.student_id) errors.push('student_id 不能为空');
  else if (row.student_id.length > 32) errors.push('student_id 过长');

  if (!row.course_name) errors.push('course_name 不能为空');
  else if (!courseNames.has(row.course_name)) errors.push(`未知课程：${row.course_name}`);

  if (!DATE_RE.test(row.learning_date) || Number.isNaN(Date.parse(`${row.learning_date}T00:00:00Z`))) {
    errors.push('learning_date 需为 YYYY-MM-DD');
  }

  if (!Number.isInteger(row.learning_minutes) || row.learning_minutes < 0 || row.learning_minutes > 1440) {
    errors.push('learning_minutes 需为 0–1440 的整数');
  }
  if (!Number.isInteger(row.chapters_done) || row.chapters_done < 0) {
    errors.push('chapters_done 需为非负整数');
  }
  if (!Number.isInteger(row.total_chapters) || row.total_chapters <= 0) {
    errors.push('total_chapters 需为正整数');
  }
  if (Number.isInteger(row.chapters_done) && Number.isInteger(row.total_chapters) && row.chapters_done > row.total_chapters) {
    errors.push('chapters_done 不能大于 total_chapters');
  }
  if (row.quiz_score !== null && (!Number.isFinite(row.quiz_score) || row.quiz_score < 0 || row.quiz_score > 100)) {
    errors.push('quiz_score 需为 0–100 或留空');
  }

  return { ok: errors.length === 0, row, errors };
}

function insertRecord(db, row) {
  return db
    .prepare(
      `INSERT INTO records(student_id, course_name, learning_date, learning_minutes, chapters_done, total_chapters, quiz_score)
       VALUES(?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.student_id,
      row.course_name,
      row.learning_date,
      row.learning_minutes,
      row.chapters_done,
      row.total_chapters,
      row.quiz_score
    );
}

/**
 * 用 CSV 文本替换全部学习记录。返回导入结果（含前 50 条错误）。
 * 只接受课程目录中存在的课程，防止脏数据进入看板。
 */
export function replaceRecordsFromCsv(db, csvText, { source = 'manual-import' } = {}) {
  const parsed = parseCsv(csvText);
  const missing = ['student_id', 'course_name', 'learning_date', 'learning_minutes', 'chapters_done', 'total_chapters'].filter(
    (c) => !parsed.headers.includes(c)
  );
  if (missing.length) {
    return { ok: false, inserted: 0, skipped: 0, errors: [`缺少必需列：${missing.join(', ')}`] };
  }

  const courseNames = new Set(db.prepare('SELECT name FROM courses').all().map((r) => r.name));
  const valid = [];
  const errors = [];
  parsed.rows.forEach((raw, i) => {
    const v = validateRow(raw, courseNames);
    if (v.ok) valid.push(v.row);
    else if (errors.length < 50) errors.push(`第 ${i + 2} 行：${v.errors.join('；')}`);
  });

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM records');
    for (const row of valid) insertRecord(db, row);
    setMeta(db, 'dataset_source', source);
    setMeta(db, 'dataset_updated_at', new Date().toISOString());
    setMeta(db, 'manual_edits', '0');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    ok: valid.length > 0,
    inserted: valid.length,
    skipped: parsed.rows.length - valid.length,
    total: parsed.rows.length,
    errors
  };
}

export function addRecord(db, raw) {
  const courseNames = new Set(db.prepare('SELECT name FROM courses').all().map((r) => r.name));
  const v = validateRow(raw, courseNames);
  if (!v.ok) return { ok: false, errors: v.errors };
  const result = insertRecord(db, v.row);
  db.prepare("INSERT INTO meta(key, value) VALUES('manual_edits','1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)").run();
  setMeta(db, 'dataset_updated_at', new Date().toISOString());
  return { ok: true, record: getRecord(db, Number(result.lastInsertRowid)) };
}

export function updateRecord(db, id, patch) {
  const current = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  if (!current) return { ok: false, notFound: true, errors: ['记录不存在'] };

  const allowed = ['student_id', 'course_name', 'learning_date', 'learning_minutes', 'chapters_done', 'total_chapters', 'quiz_score'];
  const merged = { ...current };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) merged[key] = patch[key];
  }
  const courseNames = new Set(db.prepare('SELECT name FROM courses').all().map((r) => r.name));
  const v = validateRow(merged, courseNames);
  if (!v.ok) return { ok: false, errors: v.errors };

  db.prepare(
    `UPDATE records SET student_id = ?, course_name = ?, learning_date = ?, learning_minutes = ?,
      chapters_done = ?, total_chapters = ?, quiz_score = ? WHERE id = ?`
  ).run(
    v.row.student_id,
    v.row.course_name,
    v.row.learning_date,
    v.row.learning_minutes,
    v.row.chapters_done,
    v.row.total_chapters,
    v.row.quiz_score,
    id
  );
  db.prepare("INSERT INTO meta(key, value) VALUES('manual_edits','1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)").run();
  setMeta(db, 'dataset_updated_at', new Date().toISOString());
  return { ok: true, record: getRecord(db, id) };
}

export function deleteRecord(db, id) {
  const result = db.prepare('DELETE FROM records WHERE id = ?').run(id);
  if (Number(result.changes) === 0) return { ok: false, notFound: true };
  db.prepare("INSERT INTO meta(key, value) VALUES('manual_edits','1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)").run();
  setMeta(db, 'dataset_updated_at', new Date().toISOString());
  return { ok: true };
}

export function getRecord(db, id) {
  return db.prepare('SELECT * FROM records WHERE id = ?').get(id) ?? null;
}

export function listRecords(db, { course = '', student = '', q = '', limit = 20, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (course) {
    where.push('course_name = ?');
    params.push(course);
  }
  if (student) {
    where.push('student_id LIKE ?');
    params.push(`%${student}%`);
  }
  if (q) {
    where.push('(student_id LIKE ? OR course_name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM records ${clause}`).get(...params).n;
  const lim = Math.min(200, Math.max(1, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const rows = db
    .prepare(
      `SELECT * FROM records ${clause} ORDER BY learning_date DESC, student_id ASC, id ASC LIMIT ? OFFSET ?`
    )
    .all(...params, lim, off);
  return { total, limit: lim, offset: off, rows };
}

export function getAllRecords(db) {
  return db.prepare('SELECT * FROM records ORDER BY learning_date, student_id, course_name').all();
}

export function getCourseMeta(db) {
  const contentById = new Map(COURSES.map((c) => [c.id, c]));
  const chapterStmt = db.prepare('SELECT title FROM chapters WHERE course_id = ? ORDER BY idx');
  return db
    .prepare('SELECT * FROM courses ORDER BY sort_order, id')
    .all()
    .map((c) => ({
      ...c,
      chapters: chapterStmt.all(c.id).map((row) => row.title),
      chapters_json: undefined,
      video: parseJson(c.video_json) ?? contentById.get(c.id)?.video ?? null
    }));
}

export function getChapterRows(db, courseId) {
  return db.prepare('SELECT idx, title, body FROM chapters WHERE course_id = ? ORDER BY idx').all(courseId);
}

export function getChapter(db, courseId, idx) {
  return db.prepare('SELECT idx, title, body FROM chapters WHERE course_id = ? AND idx = ?').get(courseId, idx) ?? null;
}

export function getKnowledge(db, courseId) {
  const row = db.prepare('SELECT payload_json FROM knowledge WHERE course_id = ?').get(courseId);
  return row ? JSON.parse(row.payload_json) : null;
}

export function getDatasetMeta(db) {
  return {
    source: getMetaValue(db, 'dataset_source') ?? '模拟数据',
    seedFile: path.basename(SEED_CSV),
    updatedAt: getMetaValue(db, 'dataset_updated_at'),
    importedAt: getMetaValue(db, 'seed_imported_at'),
    manualEdits: Number(getMetaValue(db, 'manual_edits') ?? 0)
  };
}

export function resetRecords(db) {
  const { text, file } = readSeedCsv();
  const result = replaceRecordsFromCsv(db, text, { source: 'seed-reset' });
  setMeta(db, 'seed_file', file);
  setMeta(db, 'seed_imported_at', new Date().toISOString());
  return result;
}

/* ------------------------------ users ------------------------------ */

export function getUserAuthByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) ?? null;
}

export function listUsers(db) {
  return db
    .prepare('SELECT id, email, name, role, active, created_at, last_login_at FROM users ORDER BY id')
    .all()
    .map((u) => ({ ...u, active: Boolean(u.active) }));
}

function validateUserInput({ email, name, password, role }, { creating }) {
  const errors = [];
  const cleanName = String(name ?? '').trim();
  const cleanEmail = normalizeEmail(email);
  if (cleanName.length < 1 || cleanName.length > 60) errors.push('姓名需要 1–60 个字符');
  if (creating || email !== undefined) {
    if (!isEmail(cleanEmail)) errors.push('邮箱格式不正确');
  }
  if (creating || password !== undefined) {
    const problem = passwordProblem(password);
    if (problem) errors.push(problem);
  }
  if (role !== undefined && !['admin', 'learner'].includes(role)) errors.push('角色只能是 admin 或 learner');
  return { errors, cleanName, cleanEmail };
}

export function createUser(db, input) {
  const v = validateUserInput({ ...input, role: input.role ?? 'learner' }, { creating: true });
  if (v.errors.length) return { ok: false, errors: v.errors };
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(v.cleanEmail)) {
    return { ok: false, errors: ['该邮箱已注册'] };
  }
  const result = db
    .prepare('INSERT INTO users(email, name, password_hash, role, active) VALUES(?, ?, ?, ?, ?)')
    .run(v.cleanEmail, v.cleanName, hashPassword(input.password), input.role ?? 'learner', input.active === false ? 0 : 1);
  return { ok: true, user: listUsers(db).find((u) => u.id === Number(result.lastInsertRowid)) };
}

export function updateUser(db, id, patch, { actingUserId } = {}) {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!current) return { ok: false, notFound: true, errors: ['用户不存在'] };

  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() : current.name,
    role: patch.role !== undefined ? patch.role : current.role,
    active: patch.active !== undefined ? Boolean(patch.active) : Boolean(current.active),
    password: patch.password
  };
  const v = validateUserInput({ name: next.name, password: next.password, role: next.role }, { creating: false });
  if (v.errors.length) return { ok: false, errors: v.errors };

  const isAdmin = current.role === 'admin' && current.active;
  const losingAdmin = isAdmin && (next.role !== 'admin' || !next.active);
  if (losingAdmin) {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
    if (admins <= 1) return { ok: false, errors: ['不能移除最后一个启用的管理员'] };
    if (actingUserId === id) return { ok: false, errors: ['不能降级或停用当前登录的管理员'] };
  }

  const hash = next.password !== undefined ? hashPassword(next.password) : current.password_hash;
  db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?').run(
    next.name,
    next.role,
    next.active ? 1 : 0,
    hash,
    id
  );
  if (!next.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return { ok: true, user: listUsers(db).find((u) => u.id === id) };
}

export function touchLogin(db, id) {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}

/* ------------------------------ courses ------------------------------ */

const COURSE_BADGE = (name) =>
  String(name)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, 2)
    .toUpperCase() || 'AI';

function validateCourseInput(input, { partial = false } = {}) {
  const errors = [];
  const out = {};
  const take = (key, maxLen, required = false) => {
    if (!partial || input[key] !== undefined) {
      const value = String(input[key] ?? '').trim();
      if (required && !value) errors.push(`${key} 不能为空`);
      else if (value.length > maxLen) errors.push(`${key} 过长`);
      out[key] = value;
    }
  };
  take('name', 80, !partial);
  take('category', 40);
  take('teacher', 40);
  take('level', 40);
  take('badge', 8);
  take('intro', 500);

  if (!partial || input.color !== undefined) {
    const color = String(input.color ?? '#2F78C4').trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) errors.push('color 必须是 #RRGGBB');
    out.color = color;
  }
  if (!partial || input.sort_order !== undefined) {
    const sort = Number(input.sort_order ?? 0);
    if (!Number.isInteger(sort)) errors.push('sort_order 必须是整数');
    out.sort_order = Number.isInteger(sort) ? sort : 0;
  }
  if (input.video !== undefined) {
    const v = input.video;
    if (v === null) out.video = null;
    else if (typeof v !== 'object' || !String(v.src ?? '').trim()) errors.push('视频 src 不能为空');
    else {
      out.video = {
        src: String(v.src).trim().slice(0, 500),
        poster: String(v.poster ?? '').trim().slice(0, 500),
        durationText: String(v.durationText ?? '示例视频').trim().slice(0, 40),
        label: '课程导览视频',
        note: String(v.note ?? '示例视频，可在后台替换。').trim().slice(0, 200),
        isPlaceholder: true
      };
    }
  }
  return { errors, out };
}

function courseNameTaken(db, name, excludeId = null) {
  return Boolean(
    db.prepare('SELECT id FROM courses WHERE name = ? AND id <> ?').get(name, excludeId ?? '')
  );
}

function nextCourseId(db) {
  const ids = db
    .prepare('SELECT id FROM courses')
    .all()
    .map((r) => Number(String(r.id).replace(/\D/g, '')) || 0);
  return `C${Math.max(0, ...ids) + 1}`;
}

export function createCourse(db, input) {
  const v = validateCourseInput(input);
  if (v.errors.length) return { ok: false, errors: v.errors };
  if (courseNameTaken(db, v.out.name)) return { ok: false, errors: ['课程名称已存在'] };
  const id = nextCourseId(db);
  db.prepare(
    `INSERT INTO courses(id, name, category, teacher, level, badge, color, intro, chapters_json, video_json, sort_order)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
  ).run(
    id,
    v.out.name,
    v.out.category || '未分类',
    v.out.teacher || '待定',
    v.out.level || '入门',
    v.out.badge || COURSE_BADGE(v.out.name),
    v.out.color || '#2F78C4',
    v.out.intro || '',
    v.out.video ? JSON.stringify(v.out.video) : null,
    v.out.sort_order || 0
  );
  return { ok: true, course: getCourseMeta(db).find((c) => c.id === id) };
}

export function updateCourse(db, id, patch) {
  const current = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!current) return { ok: false, notFound: true, errors: ['课程不存在'] };
  const v = validateCourseInput(patch, { partial: true });
  if (v.errors.length) return { ok: false, errors: v.errors };

  const next = {
    name: v.out.name ?? current.name,
    category: v.out.category ?? current.category,
    teacher: v.out.teacher ?? current.teacher,
    level: v.out.level ?? current.level,
    badge: v.out.badge ?? current.badge,
    color: v.out.color ?? current.color,
    intro: v.out.intro ?? current.intro,
    sort_order: v.out.sort_order ?? current.sort_order
  };
  if (!next.name) return { ok: false, errors: ['课程名称不能为空'] };
  if (next.name !== current.name && courseNameTaken(db, next.name, id)) {
    return { ok: false, errors: ['课程名称已存在'] };
  }
  const videoJson = patch.video !== undefined ? (v.out.video ? JSON.stringify(v.out.video) : null) : current.video_json;

  db.exec('BEGIN');
  try {
    db.prepare(
      'UPDATE courses SET name = ?, category = ?, teacher = ?, level = ?, badge = ?, color = ?, intro = ?, video_json = ?, sort_order = ? WHERE id = ?'
    ).run(
      next.name,
      next.category,
      next.teacher,
      next.level,
      next.badge,
      next.color,
      next.intro,
      videoJson,
      next.sort_order,
      id
    );
    if (next.name !== current.name) {
      db.prepare('UPDATE records SET course_name = ? WHERE course_name = ?').run(next.name, current.name);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true, course: getCourseMeta(db).find((c) => c.id === id) };
}

export function deleteCourse(db, id, { force = false } = {}) {
  const current = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!current) return { ok: false, notFound: true, errors: ['课程不存在'] };
  const recordCount = db.prepare('SELECT COUNT(*) AS n FROM records WHERE course_name = ?').get(current.name).n;
  if (recordCount > 0 && !force) {
    return { ok: false, conflict: true, records: recordCount, errors: [`课程还有 ${recordCount} 条学习记录`] };
  }
  db.exec('BEGIN');
  try {
    if (force) db.prepare('DELETE FROM records WHERE course_name = ?').run(current.name);
    db.prepare('DELETE FROM chapters WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM knowledge WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true, deletedRecords: recordCount };
}

function validateChapter(input, { partial = false } = {}) {
  const errors = [];
  const out = {};
  if (!partial || input.title !== undefined) {
    const title = String(input.title ?? '').trim();
    if (!title) errors.push('章节标题不能为空');
    else if (title.length > 160) errors.push('章节标题过长');
    out.title = title;
  }
  if (!partial || input.body !== undefined) {
    const body = String(input.body ?? '').trim();
    if (!body) errors.push('章节正文不能为空');
    else if (body.length > 50000) errors.push('章节正文过长');
    out.body = body;
  }
  return { errors, out };
}

export function addChapter(db, courseId, input) {
  if (!db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId)) {
    return { ok: false, notFound: true, errors: ['课程不存在'] };
  }
  const v = validateChapter(input);
  if (v.errors.length) return { ok: false, errors: v.errors };
  const max = db.prepare('SELECT MAX(idx) AS n FROM chapters WHERE course_id = ?').get(courseId).n ?? 0;
  const idx = Number(max) + 1;
  db.prepare('INSERT INTO chapters(course_id, idx, title, body) VALUES(?, ?, ?, ?)').run(
    courseId,
    idx,
    v.out.title,
    v.out.body
  );
  return { ok: true, chapter: { idx, title: v.out.title, body: v.out.body } };
}

export function updateChapter(db, courseId, idx, input) {
  const current = db.prepare('SELECT idx, title, body FROM chapters WHERE course_id = ? AND idx = ?').get(courseId, idx);
  if (!current) return { ok: false, notFound: true, errors: ['章节不存在'] };
  const v = validateChapter(input, { partial: true });
  if (v.errors.length) return { ok: false, errors: v.errors };
  const title = v.out.title ?? current.title;
  const body = v.out.body ?? current.body;
  db.prepare('UPDATE chapters SET title = ?, body = ? WHERE course_id = ? AND idx = ?').run(title, body, courseId, idx);
  return { ok: true, chapter: { idx, title, body } };
}

export function deleteChapter(db, courseId, idx) {
  const result = db.prepare('DELETE FROM chapters WHERE course_id = ? AND idx = ?').run(courseId, idx);
  if (Number(result.changes) === 0) return { ok: false, notFound: true, errors: ['章节不存在'] };
  return { ok: true };
}

export function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  ensureColumn(db, 'courses', 'video_json', 'TEXT');
  syncCatalog(db);
  syncChapters(db);

  const count = db.prepare('SELECT COUNT(*) AS n FROM records').get().n;
  if (count === 0) {
    const res = resetRecords(db);
    if (!res.ok) throw new Error(`种子数据导入失败：${res.errors.join('；')}`);
    console.log(`[db] 已从 ${path.basename(SEED_CSV)} 导入 ${res.inserted} 条学习记录`);
  }

  return db;
}

