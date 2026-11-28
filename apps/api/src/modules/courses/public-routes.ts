/**
 * Public catalogue endpoints (F031).
 *
 * - `GET /meta`                 → overview, dataset metadata, course references.
 * - `GET /courses?q=&category=` → courses with per-course stats, all categories,
 *                                 site-wide overview (filters do not change it).
 * - `GET /courses/:idOrName`    → course, stats and inferred chapter reach.
 *
 * Responses deliberately omit the internal `video_json`/`video_mode` state and
 * never expose raw learning records; every number is computed by
 * `@portal/domain` from the records joined with their course names.
 */
import { Router, type Request } from 'express';
import { byCourse, chapterStats, groupEnrollments, summarize } from '@portal/domain';
import type { CourseMeta, CourseStats } from '@portal/contracts';
import { notFound } from '../../lib/errors.js';
import { appDeps } from '../../lib/types.js';
import {
  findCourse,
  listChapterRows,
  listCourses,
  listRecords,
  readDatasetMeta,
  type CatalogCourse,
} from '../../db/repositories/catalog.js';

export const publicCoursesRouter = Router();

/** Public course metadata, mirroring `CourseMetaSchema` (no internal columns). */
export function toCourseMeta(course: CatalogCourse): CourseMeta {
  return {
    id: course.id,
    name: course.name,
    category: course.category,
    teacher: course.teacher,
    level: course.level,
    badge: course.badge,
    color: course.color,
    intro: course.intro,
    sort_order: course.sort_order,
    chapters: course.chapters,
    video: course.video,
  };
}

/** First value of a query parameter (v1 `URLSearchParams#get` semantics). */
function firstQuery(req: Request, name: string): string {
  const raw = req.query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : '';
}

publicCoursesRouter.get('/meta', async (req, res) => {
  const { db } = appDeps(req);
  const [courses, records, dataset] = await Promise.all([
    listCourses(db),
    listRecords(db),
    readDatasetMeta(db),
  ]);
  const enrollments = groupEnrollments(records);

  res.json({
    overview: summarize(records, enrollments),
    dataset,
    courses: courses.map(({ id, name, category }) => ({ id, name, category })),
  });
});

publicCoursesRouter.get('/courses', async (req, res) => {
  const { db } = appDeps(req);
  const [courses, records] = await Promise.all([listCourses(db), listRecords(db)]);
  const enrollments = groupEnrollments(records);

  const stats = byCourse(
    records,
    enrollments,
    courses.map((course) => course.name),
  );
  const statsByName = new Map<string, CourseStats>(stats.map((entry) => [entry.course_name, entry]));

  let list = courses.map((course) => ({
    ...toCourseMeta(course),
    stats: statsByName.get(course.name) as CourseStats,
  }));

  const q = firstQuery(req, 'q').trim().toLowerCase();
  const category = firstQuery(req, 'category');
  if (q) {
    list = list.filter(
      (course) =>
        course.name.toLowerCase().includes(q) ||
        (course.intro ?? '').toLowerCase().includes(q) ||
        course.teacher.toLowerCase().includes(q) ||
        course.category.toLowerCase().includes(q),
    );
  }
  if (category) list = list.filter((course) => course.category === category);

  res.json({
    courses: list,
    categories: [...new Set(courses.map((course) => course.category))],
    overview: summarize(records, enrollments),
  });
});

publicCoursesRouter.get('/courses/:idOrName', async (req, res) => {
  const { db } = appDeps(req);
  const courses = await listCourses(db);
  const course = findCourse(courses, req.params.idOrName);
  if (!course) throw notFound('课程不存在');

  const [records, chapterRows] = await Promise.all([listRecords(db), listChapterRows(db, course.id)]);
  const enrollments = groupEnrollments(records);
  const stats = byCourse(records, enrollments, [course.name])[0] as CourseStats;

  res.json({
    course: toCourseMeta(course),
    stats,
    chapterStats: chapterStats(enrollments, course.name, chapterRows),
  });
});