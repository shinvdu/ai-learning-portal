import { z } from 'zod';
import { optionalQueryString } from './common.js';
import { CourseStatsSchema, OverviewSchema } from './dashboard.js';
import { DatasetMetaSchema } from './dataset.js';

export const VideoModeSchema = z.enum(['inherit', 'custom', 'none']);
export type VideoMode = z.infer<typeof VideoModeSchema>;

/** Resolved video configuration shown on public course/chapter pages. */
export const CourseVideoSchema = z.object({
  src: z.string(),
  poster: z.string().optional(),
  duration: z.string().optional(),
  durationText: z.string().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
  isPlaceholder: z.boolean().optional(),
});

export type CourseVideo = z.infer<typeof CourseVideoSchema>;

/** Public course metadata (v1 `getCourseMeta` minus internal JSON columns). */
export const CourseMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  teacher: z.string(),
  level: z.string(),
  badge: z.string().nullable(),
  color: z.string().nullable(),
  intro: z.string().nullable(),
  sort_order: z.number().int(),
  chapters: z.array(z.string()),
  video: CourseVideoSchema.nullable(),
  /** v2 explicit video state; omitted by v1-compatible responses. */
  video_mode: VideoModeSchema.optional(),
});

export type CourseMeta = z.infer<typeof CourseMetaSchema>;

export const ChapterRowSchema = z.object({
  idx: z.number().int(),
  title: z.string(),
  body: z.string(),
});

export type ChapterRow = z.infer<typeof ChapterRowSchema>;

/** Admin view of a chapter, including the raw video three-state fields. */
export const AdminChapterRowSchema = ChapterRowSchema.extend({
  video_mode: VideoModeSchema,
  video: CourseVideoSchema.nullable(),
});

export type AdminChapterRow = z.infer<typeof AdminChapterRowSchema>;

export const ChapterStatSchema = z.object({
  idx: z.number().int(),
  title: z.string(),
  total: z.number().int(),
  reached: z.number().int(),
  notReached: z.number().int(),
  reachRate: z.number().nullable(),
  avgScoreReached: z.number().nullable(),
  avgScoreNotReached: z.number().nullable(),
  scoredReached: z.number().int(),
  scoredNotReached: z.number().int(),
});

export type ChapterStat = z.infer<typeof ChapterStatSchema>;

export const CourseWithStatsSchema = CourseMetaSchema.extend({
  stats: CourseStatsSchema,
});

export type CourseWithStats = z.infer<typeof CourseWithStatsSchema>;

export const CoursesQuerySchema = z.object({
  q: optionalQueryString,
  category: optionalQueryString,
});

export type CoursesQuery = z.infer<typeof CoursesQuerySchema>;

export const CoursesPathParamsSchema = z.object({
  idOrName: z.string().min(1),
});

export type CoursesPathParams = z.infer<typeof CoursesPathParamsSchema>;

export const CoursesResponseSchema = z.object({
  courses: z.array(CourseWithStatsSchema),
  categories: z.array(z.string()),
  overview: OverviewSchema,
});

export type CoursesResponse = z.infer<typeof CoursesResponseSchema>;

export const CourseDetailResponseSchema = z.object({
  course: CourseMetaSchema,
  stats: CourseStatsSchema,
  chapterStats: z.array(ChapterStatSchema),
});

export type CourseDetailResponse = z.infer<typeof CourseDetailResponseSchema>;

export const MetaResponseSchema = z.object({
  overview: OverviewSchema,
  dataset: DatasetMetaSchema,
  courses: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
    }),
  ),
});

export type MetaResponse = z.infer<typeof MetaResponseSchema>;

/* ------------------------------ admin courses ----------------------------- */

const LOCAL_PATH_MESSAGE = '视频与封面必须使用站内路径（以 / 开头）';

const isSafeLocalPath = (value: string): boolean =>
  value === '' || (/^\/(?!\/)/.test(value) && !value.includes('..') && !value.includes('\\'));

const localPath = (allowEmpty: boolean) => {
  const base = allowEmpty ? z.string().trim().max(500) : z.string().trim().min(1).max(500);
  return base.refine(isSafeLocalPath, LOCAL_PATH_MESSAGE);
};

export const CourseVideoInputSchema = z.object({
  src: localPath(false),
  poster: localPath(true).optional(),
  durationText: z.string().trim().max(40).optional(),
  note: z.string().trim().max(200).optional(),
});

export type CourseVideoInput = z.infer<typeof CourseVideoInputSchema>;

const CourseBodyBaseSchema = z.object({
  name: z.string().trim().min(1, 'name 不能为空').max(80, 'name 过长'),
  category: z.string().trim().max(40, 'category 过长').optional(),
  teacher: z.string().trim().max(40, 'teacher 过长').optional(),
  level: z.string().trim().max(40, 'level 过长').optional(),
  badge: z.string().trim().max(8, 'badge 过长').optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-f]{6}$/i, 'color 必须是 #RRGGBB')
    .optional(),
  intro: z.string().trim().max(500, 'intro 过长').optional(),
  sort_order: z.coerce.number().int('sort_order 必须是整数').optional(),
  video: CourseVideoInputSchema.nullable().optional(),
});

export const CourseCreateBodySchema = CourseBodyBaseSchema;
export type CourseCreateBody = z.infer<typeof CourseCreateBodySchema>;

export const CourseUpdateBodySchema = CourseBodyBaseSchema.partial();
export type CourseUpdateBody = z.infer<typeof CourseUpdateBodySchema>;

export const AdminCourseSchema = CourseMetaSchema.extend({
  stats: CourseStatsSchema.nullable(),
  chapterDetails: z.array(AdminChapterRowSchema),
});

export type AdminCourse = z.infer<typeof AdminCourseSchema>;

export const AdminCoursesResponseSchema = z.object({
  courses: z.array(AdminCourseSchema),
});

export type AdminCoursesResponse = z.infer<typeof AdminCoursesResponseSchema>;

export const CourseMutationResponseSchema = z.object({
  ok: z.literal(true),
  course: CourseMetaSchema,
});

export type CourseMutationResponse = z.infer<typeof CourseMutationResponseSchema>;

export const CourseDeleteResponseSchema = z.object({
  ok: z.literal(true),
  deletedRecords: z.number().int().nonnegative(),
});

export type CourseDeleteResponse = z.infer<typeof CourseDeleteResponseSchema>;

export const CourseDeleteQuerySchema = z.object({
  force: z.literal('1').optional(),
});

export type CourseDeleteQuery = z.infer<typeof CourseDeleteQuerySchema>;