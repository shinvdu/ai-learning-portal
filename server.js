import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getAllRecords, getCourseMeta, getKnowledge, getChapterRows, getChapter, listRecords, addRecord, updateRecord, deleteRecord, replaceRecordsFromCsv, resetRecords, getDatasetMeta, ROOT } from './src/db.js';
import { groupEnrollments, summarize, byCourse, buildDashboard, buildInsights, dataQuality, chapterStats } from './src/analytics.js';
import { toCsv } from './src/csv.js';
import { PITFALLS, CHAPTER_VIDEO_DEFAULT, CHAPTER_VIDEOS } from './src/content.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const BODY_LIMIT = 2 * 1024 * 1024;

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
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
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

function apiRoute(db, req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

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
    if (!knowledge) return sendJson(res, 404, { error: '该课程暂无知识文档' });
    return sendJson(res, 200, {
      course: { id: course.id, name: course.name, chapters: course.chapters, color: course.color, badge: course.badge },
      knowledge
    });
  }

  if (req.method === 'GET' && p === '/api/dashboard') {
    return sendJson(res, 200, dashboardPayload(db, q.get('course') || ''));
  }

  if (req.method === 'GET' && p === '/api/insights') {
    return sendJson(res, 200, insightsPayload(db));
  }

  if (req.method === 'GET' && p === '/api/records') {
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
    return readJson(req).then((body) => {
      const result = addRecord(db, body);
      if (!result.ok) return sendJson(res, 400, result);
      return sendJson(res, 201, { ...result, dataset: getDatasetMeta(db) });
    });
  }

  const recordMatch = p.match(/^\/api\/records\/(\d+)$/);
  if (recordMatch && req.method === 'PATCH') {
    const id = Number(recordMatch[1]);
    return readJson(req).then((body) => {
      if (!body || Object.keys(body).length === 0) return sendJson(res, 400, { error: '没有需要更新的字段' });
      const result = updateRecord(db, id, body);
      if (!result.ok) return sendJson(res, result.notFound ? 404 : 400, result);
      return sendJson(res, 200, { ...result, dataset: getDatasetMeta(db) });
    });
  }

  if (recordMatch && req.method === 'DELETE') {
    const result = deleteRecord(db, Number(recordMatch[1]));
    if (!result.ok) return sendJson(res, 404, result);
    return sendJson(res, 200, { ok: true, dataset: getDatasetMeta(db) });
  }

  if (req.method === 'POST' && p === '/api/records/import') {
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
      return sendJson(res, result.ok ? 200 : 400, { ...result, dataset: getDatasetMeta(db) });
    });
  }

  if (req.method === 'POST' && p === '/api/admin/reset') {
    const result = resetRecords(db);
    return sendJson(res, result.ok ? 200 : 500, { ...result, dataset: getDatasetMeta(db) });
  }

  if (req.method === 'GET' && p === '/api/export.csv') {
    const csv = toCsv(getAllRecords(db));
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
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      Promise.resolve()
        .then(() => apiRoute(db, req, res, url))
        .catch((err) => {
          const status = err.status || 500;
          if (status === 500) console.error('[api]', err);
          if (!res.headersSent) sendJson(res, status, { error: err.message || '服务器内部错误' });
        });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method not allowed');
    }
    serveStatic(req, res, url);
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const db = openDb();
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