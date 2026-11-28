/**
 * `/api/v1/admin/courses/:courseId/chapters[/:idx]` (F061).
 *
 * - `POST` appends a chapter at `MAX(idx) + 1` (a per-course advisory lock
 *   serialises concurrent appends).
 * - `PATCH` updates title/body of one exact index.
 * - `DELETE` removes one exact index and keeps the numbering gap (no renumber)
 *   so historical chapter-reach statistics stay interpretable.
 */
import { Router } from 'express';
import { and, eq, max, sql } from 'drizzle-orm';
import {
  chapters as chaptersTable,
  type CourseVideo,
  type Db,
  type VideoMode,
} from '@portal/db';
import { AUDIT_ACTION } from '@portal/contracts';
import { appDeps } from '../../lib/types.js';
import { notFound } from '../../lib/errors.js';
import { resolveCreateVideo, resolveUpdateVideo } from '../../lib/video.js';
import { auditRequest } from '../audit/service.js';
import { courseExists } from '../../db/repositories/courses-admin.js';

export const adminChaptersRouter = Router({ mergeParams: true });

type ChapterInput = {
  title?: unknown;
  body?: unknown;
  video_mode?: unknown;
  video?: unknown;
};

type ChapterRecord = {
  idx: number;
  title: string;
  body: string;
  video_mode: VideoMode;
  video: CourseVideo | null;
};

function bodyOf(value: unknown): ChapterInput {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ChapterInput)
    : {};
}

function parseIdx(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) throw notFound('接口不存在');
  const idx = Number(raw);
  if (!Number.isSafeInteger(idx) || idx > 2_147_483_647) throw notFound('章节不存在');
  return idx;
}

/** Validate title/body; partial updates only look at supplied fields. */
function validateChapter(
  input: ChapterInput,
  options: { partial: boolean },
): { errors: string[]; title?: string; body?: string } {
  const errors: string[] = [];
  let title: string | undefined;
  let body: string | undefined;

  if (!options.partial || input.title !== undefined) {
    const value = String(input.title ?? '').trim();
    if (!value) errors.push('章节标题不能为空');
    else if (value.length > 160) errors.push('章节标题过长');
    title = value;
  }
  if (!options.partial || input.body !== undefined) {
    const value = String(input.body ?? '').trim();
    if (!value) errors.push('章节正文不能为空');
    else if (value.length > 50_000) errors.push('章节正文过长');
    body = value;
  }
  return { errors, title, body };
}

adminChaptersRouter.post('/', async (req, res) => {
  const { db } = appDeps(req);
  const courseId = (req.params as Record<string, string | undefined>)['courseId'] as string;

  if (!(await courseExists(db, courseId))) {
    res.status(404).json({ ok: false, notFound: true, errors: ['课程不存在'] });
    return;
  }

  const body = bodyOf(req.body);
  const validation = validateChapter(body, { partial: false });
  const video = resolveCreateVideo(body as Record<string, unknown>, 'inherit');
  const errors = [...validation.errors, ...video.errors];
  if (errors.length > 0) {
    res.status(400).json({ ok: false, errors });
    return;
  }

  const chapter: ChapterRecord = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${courseId}))`);
    const [row] = await tx
      .select({ value: max(chaptersTable.idx) })
      .from(chaptersTable)
      .where(eq(chaptersTable.course_id, courseId));
    const idx = Number(row?.value ?? 0) + 1;
    const record: ChapterRecord = {
      idx,
      title: validation.title as string,
      body: validation.body as string,
      video_mode: video.mode ?? 'inherit',
      video: video.video ?? null,
    };
    await tx.insert(chaptersTable).values({
      course_id: courseId,
      idx: record.idx,
      title: record.title,
      body: record.body,
      video_mode: record.video_mode,
      video: record.video,
    });
    return record;
  });

  await auditRequest(req, db, AUDIT_ACTION.ADMIN_CHAPTER_CREATED, {
    targetType: 'chapter',
    targetId: `${courseId}-${chapter.idx}`,
    details: { title: chapter.title },
  });
  res.status(201).json({ ok: true, chapter });
});

adminChaptersRouter.patch('/:idx', async (req, res) => {
  const { db } = appDeps(req);
  const courseId = (req.params as Record<string, string | undefined>)['courseId'] as string;
  const idx = parseIdx((req.params as Record<string, string | undefined>)['idx']);
  const current = await readChapter(db, courseId, idx);
  if (!current) {
    res.status(404).json({ ok: false, notFound: true, errors: ['章节不存在'] });
    return;
  }

  const body = bodyOf(req.body);
  const validation = validateChapter(body, { partial: true });
  const video = resolveUpdateVideo(body as Record<string, unknown>, {
    existingMode: current.video_mode,
    existingVideo: current.video,
  });
  const errors = [...validation.errors, ...video.errors];
  if (errors.length > 0) {
    res.status(400).json({ ok: false, errors });
    return;
  }

  const chapter: ChapterRecord = {
    idx,
    title: validation.title ?? current.title,
    body: validation.body ?? current.body,
    video_mode: video.mode ?? current.video_mode,
    video: video.mode === undefined ? current.video : video.video ?? null,
  };
  await db
    .update(chaptersTable)
    .set({
      title: chapter.title,
      body: chapter.body,
      video_mode: chapter.video_mode,
      video: chapter.video,
    })
    .where(and(eq(chaptersTable.course_id, courseId), eq(chaptersTable.idx, idx)));

  await auditRequest(req, db, AUDIT_ACTION.ADMIN_CHAPTER_UPDATED, {
    targetType: 'chapter',
    targetId: `${courseId}-${idx}`,
    details: { fields: Object.keys(body), video_mode: chapter.video_mode },
  });
  res.json({ ok: true, chapter });
});

adminChaptersRouter.delete('/:idx', async (req, res) => {
  const { db } = appDeps(req);
  const courseId = (req.params as Record<string, string | undefined>)['courseId'] as string;
  const idx = parseIdx((req.params as Record<string, string | undefined>)['idx']);

  const removed = await db
    .delete(chaptersTable)
    .where(and(eq(chaptersTable.course_id, courseId), eq(chaptersTable.idx, idx)))
    .returning({ idx: chaptersTable.idx });
  if (removed.length === 0) {
    res.status(404).json({ ok: false, notFound: true, errors: ['章节不存在'] });
    return;
  }

  await auditRequest(req, db, AUDIT_ACTION.ADMIN_CHAPTER_DELETED, {
    targetType: 'chapter',
    targetId: `${courseId}-${idx}`,
  });
  res.json({ ok: true });
});

async function readChapter(
  db: Db,
  courseId: string,
  idx: number,
): Promise<{
  title: string;
  body: string;
  video_mode: VideoMode;
  video: CourseVideo | null;
} | null> {
  const [row] = await db
    .select({
      title: chaptersTable.title,
      body: chaptersTable.body,
      video_mode: chaptersTable.video_mode,
      video: chaptersTable.video,
    })
    .from(chaptersTable)
    .where(and(eq(chaptersTable.course_id, courseId), eq(chaptersTable.idx, idx)))
    .limit(1);
  if (!row) return null;
  return { ...row, video: row.video ?? null };
}