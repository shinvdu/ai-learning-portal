import { z } from 'zod';
import { SimpleOkResponseSchema } from './common.js';
import {
  AdminChapterRowSchema,
  ChapterRowSchema,
  ChapterStatSchema,
  CourseVideoInputSchema,
  CourseVideoSchema,
  VideoModeSchema,
} from './courses.js';
import { QuizSchema } from './knowledge.js';

export const ChapterCourseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  badge: z.string().nullable(),
  chapters: z.array(z.string()),
  video: CourseVideoSchema.nullable(),
});

export type ChapterCourse = z.infer<typeof ChapterCourseSchema>;

export const ChapterDetailSchema = ChapterRowSchema.extend({
  /** Resolved chapter video; `null` when the chapter (or its course) has none. */
  video: CourseVideoSchema.nullable(),
});

export type ChapterDetail = z.infer<typeof ChapterDetailSchema>;

export const ChapterPathParamsSchema = z.object({
  courseId: z.string().min(1),
  idx: z.coerce.number().int().nonnegative(),
});

export type ChapterPathParams = z.infer<typeof ChapterPathParamsSchema>;

export const ChapterCourseParamsSchema = z.object({
  courseId: z.string().min(1),
});

export type ChapterCourseParams = z.infer<typeof ChapterCourseParamsSchema>;

export const ChapterResponseSchema = z.object({
  course: ChapterCourseSchema,
  chapter: ChapterDetailSchema,
  stats: ChapterStatSchema.nullable(),
  chapterStats: z.array(ChapterStatSchema),
  relatedQuiz: z.array(QuizSchema),
  prev: ChapterRowSchema.nullable(),
  next: ChapterRowSchema.nullable(),
});

export type ChapterResponse = z.infer<typeof ChapterResponseSchema>;

/* ------------------------------ admin chapters ---------------------------- */

const ChapterBodyBaseSchema = z.object({
  title: z.string().trim().min(1, '章节标题不能为空').max(160, '章节标题过长'),
  body: z.string().trim().min(1, '章节正文不能为空').max(50000, '章节正文过长'),
  video_mode: VideoModeSchema.optional(),
  video: CourseVideoInputSchema.nullable().optional(),
});

export const ChapterCreateBodySchema = ChapterBodyBaseSchema;
export type ChapterCreateBody = z.infer<typeof ChapterCreateBodySchema>;

export const ChapterUpdateBodySchema = ChapterBodyBaseSchema.partial();
export type ChapterUpdateBody = z.infer<typeof ChapterUpdateBodySchema>;

export const ChapterMutationResponseSchema = z.object({
  ok: z.literal(true),
  chapter: AdminChapterRowSchema,
});

export type ChapterMutationResponse = z.infer<typeof ChapterMutationResponseSchema>;

export const ChapterDeleteResponseSchema = SimpleOkResponseSchema;
export type ChapterDeleteResponse = z.infer<typeof ChapterDeleteResponseSchema>;