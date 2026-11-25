import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { COURSES, KNOWLEDGE } from './content.js';
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

  CREATE INDEX IF NOT EXISTS idx_records_course ON records(course_name);
  CREATE INDEX IF NOT EXISTS idx_records_student ON records(student_id);
  CREATE INDEX IF NOT EXISTS idx_records_date ON records(learning_date);
`;

function readSeedCsv() {
  const file = fs.existsSync(SEED_CSV) ? SEED_CSV : FALLBACK_CSV;
  if (!fs.existsSync(file)) throw new Error(`找不到种子 CSV：${SEED_CSV}`);
  return { text: fs.readFileSync(file, 'utf8'), file };
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

/** 把 data/lectures/*.txt 的章节原文同步到 chapters 表（每次启动重建）。 */
export function syncChapters(db) {
  for (const course of COURSES) {
    if (!course.lectureFile) continue;
    const file = path.join(LECTURE_DIR, course.lectureFile);
    if (!fs.existsSync(file)) throw new Error(`缺少课程讲义：${file}`);
    const parsed = parseLecture(fs.readFileSync(file, 'utf8'));
    if (parsed.length === 0) throw new Error(`讲义中未找到章节：${file}`);
    if (course.chapters && parsed.length !== course.chapters.length) {
      console.warn(`[db] ${course.name} 讲义章节数 ${parsed.length} 与课程目录 ${course.chapters.length} 不一致`);
    }
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM chapters WHERE course_id = ?').run(course.id);
      const stmt = db.prepare('INSERT INTO chapters(course_id, idx, title, body) VALUES(?, ?, ?, ?)');
      for (const ch of parsed) stmt.run(course.id, ch.idx, ch.title, ch.body);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function syncCatalog(db) {
  const courseStmt = db.prepare(`
    INSERT INTO courses(id, name, category, teacher, level, badge, color, intro, chapters_json, sort_order)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      teacher = excluded.teacher,
      level = excluded.level,
      badge = excluded.badge,
      color = excluded.color,
      intro = excluded.intro,
      chapters_json = excluded.chapters_json,
      sort_order = excluded.sort_order
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

  const knowledgeStmt = db.prepare(`
    INSERT INTO knowledge(course_id, payload_json) VALUES(?, ?)
    ON CONFLICT(course_id) DO UPDATE SET payload_json = excluded.payload_json
  `);
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
  const videoById = new Map(COURSES.map((c) => [c.id, c.video ?? null]));
  return db
    .prepare('SELECT * FROM courses ORDER BY sort_order')
    .all()
    .map((c) => ({
      ...c,
      chapters: JSON.parse(c.chapters_json),
      chapters_json: undefined,
      video: videoById.get(c.id) ?? null
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

export function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
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

