/**
 * Public chapter endpoint (F032).
 *
 * `GET /chapters/:courseId/:idx` returns the chapter, its course, resolved
 * videos, the inferred reach statistics, the quiz questions sourced from that
 * chapter and the existing adjacent indexes only.
 *
 * 404 semantics mirror v1: a non-numeric index is an unknown route
 * (`接口不存在`), an unknown course is `课程不存在`, and an unknown exact index
 * is `章节不存在`.
 */
import { Router } from 'express';
import { chapterStats as buildChapterStats, groupEnrollments } from '@portal/domain';
import { CHAPTER_VIDEO_DEFAULT, CHAPTER_VIDEOS } from '@portal/content';
import type { CourseVideo, Quiz } from '@portal/contracts';
import { notFound } from '../../lib/errors.js';
import { appDeps } from '../../lib/types.js';
import {
  findChapterRow,
  findCourse,
  getKnowledgePayload,
  listChapterRows,
  listCourses,
  listRecords,
  type CatalogCourse,
  type ChapterWithVideo,
} from '../../db/repositories/catalog.js';

export const chaptersRouter = Router();

const DIGITS = /^\d+$/;
const CHAPTER_SOURCE = /第\s*(\d+)\s*章/;

/**
 * Resolve a chapter's public video (F096). Precedence:
 *  - `none`   → `null`
 *  - `custom` → the chapter payload
 *  - `inherit`→ `CHAPTER_VIDEOS['<courseId>-<idx>']` when present, otherwise the
 *    course's resolved video (`inherit` content default / `custom` / `none`).
 */
function resolveChapterVideo(
  chapter: Pick<ChapterWithVideo, 'video_mode' | 'video'>,
  course: CatalogCourse,
  idx: number,
): CourseVideo | null {
  if (chapter.video_mode === 'none') return null;
  if (chapter.video_mode === 'custom') return chapter.video ?? null;
  const override = CHAPTER_VIDEOS[`${course.id}-${idx}`];
  if (override) return { ...(course.video ?? CHAPTER_VIDEO_DEFAULT), ...override };
  return course.video;
}

chaptersRouter.get('/chapters/:courseId/:idx', async (req, res) => {
  const { db } = appDeps(req);
  const rawIdx = req.params.idx;

  // v1 only routed `\d+`; anything else fell through to the generic 404.
  if (!DIGITS.test(rawIdx)) throw notFound('接口不存在');
  const idx = Number(rawIdx);
  // `chapters.idx` is a 32-bit integer; anything outside that range simply
  // cannot exist (and must not reach PostgreSQL as a parameter).
  if (!Number.isSafeInteger(idx) || idx < 0 || idx > 2_147_483_647) throw notFound('章节不存在');

  const courses = await listCourses(db);
  const course = findCourse(courses, req.params.courseId);
  if (!course) throw notFound('课程不存在');

  const [chapterRows, records, knowledge] = await Promise.all([
    listChapterRows(db, course.id),
    listRecords(db),
    getKnowledgePayload(db, course.id),
  ]);

  const chapter = await findChapterRow(db, course.id, idx);
  if (!chapter) throw notFound('章节不存在');

  const enrollments = groupEnrollments(records);
  const allChapterStats = buildChapterStats(enrollments, course.name, chapterRows);
  const stats = allChapterStats.find((entry) => entry.idx === idx) ?? null;

  const relatedQuiz = ((knowledge?.quiz ?? []) as Quiz[]).filter((question) => {
    const match = String(question.source || '').match(CHAPTER_SOURCE);
    return Boolean(match && Number(match[1]) === idx);
  });

  res.json({
    course: {
      id: course.id,
      name: course.name,
      color: course.color,
      badge: course.badge,
      chapters: course.chapters,
      video: course.video,
    },
    chapter: {
      idx: chapter.idx,
      title: chapter.title,
      body: chapter.body,
      video: resolveChapterVideo(chapter, course, idx),
    },
    stats,
    chapterStats: allChapterStats,
    relatedQuiz,
    prev: chapterRows.find((row) => row.idx === idx - 1) ?? null,
    next: chapterRows.find((row) => row.idx === idx + 1) ?? null,
  });
});