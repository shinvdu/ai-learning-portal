import { z } from 'zod';
import { DatasetMetaSchema } from './dataset.js';
import { optionalQueryString } from './common.js';

export const InsightTypeSchema = z.enum([
  'progress',
  'correlation',
  'timing',
  'quality',
  'comparison',
]);

export type InsightType = z.infer<typeof InsightTypeSchema>;

/** Aggregate KPIs computed by `@portal/domain` (v1 `summarize`). */
export const OverviewSchema = z.object({
  students: z.number().int(),
  courses: z.number().int(),
  enrollments: z.number().int(),
  records: z.number().int(),
  avgCompletion: z.number().nullable(),
  avgScore: z.number().nullable(),
  scoredEnrollments: z.number().int(),
  noScoreEnrollments: z.number().int(),
  totalMinutes: z.number(),
  totalHours: z.number().nullable(),
});

export type Overview = z.infer<typeof OverviewSchema>;

/** Per-course metrics (v1 `byCourse`). */
export const CourseStatsSchema = z.object({
  course_name: z.string(),
  learners: z.number().int(),
  records: z.number().int(),
  enrollments: z.number().int(),
  completion: z.number().nullable(),
  avgScore: z.number().nullable(),
  scoredEnrollments: z.number().int(),
  noScoreEnrollments: z.number().int(),
  minutes: z.number(),
  hours: z.number().nullable(),
  chapters: z.number().int(),
});

export type CourseStats = z.infer<typeof CourseStatsSchema>;

export const DailyPointSchema = z.object({
  date: z.string(),
  sessions: z.number().int(),
  minutes: z.number(),
  students: z.number().int(),
});

export type DailyPoint = z.infer<typeof DailyPointSchema>;

export const WeekdayStatSchema = z.object({
  label: z.string(),
  sessions: z.number().int(),
  minutes: z.number(),
  students: z.number().int(),
});

export type WeekdayStat = z.infer<typeof WeekdayStatSchema>;

export const BucketSchema = z.object({
  label: z.string(),
  count: z.number().int(),
});

export type Bucket = z.infer<typeof BucketSchema>;

export const DataQualitySchema = z.object({
  dateFrom: z.string().nullable(),
  dateTo: z.string().nullable(),
  days: z.number().int(),
  records: z.number().int(),
  enrollments: z.number().int(),
  students: z.number().int(),
  courses: z.number().int(),
  noScoreEnrollments: z.number().int(),
  scoredEnrollments: z.number().int(),
});

export type DataQuality = z.infer<typeof DataQualitySchema>;

export const InsightSchema = z.object({
  id: z.string(),
  type: InsightTypeSchema,
  tag: z.string(),
  title: z.string(),
  evidence: z.string(),
  action: z.string(),
});

export type Insight = z.infer<typeof InsightSchema>;

/** Lightweight course reference used by filters and colour lookups. */
export const CourseCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  badge: z.string().nullable(),
});

export type CourseCatalogItem = z.infer<typeof CourseCatalogItemSchema>;

export const DashboardQuerySchema = z.object({
  course: optionalQueryString,
});

export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

export const DashboardResponseSchema = z.object({
  overview: OverviewSchema,
  byCourse: z.array(CourseStatsSchema),
  daily: z.array(DailyPointSchema),
  weekday: z.array(WeekdayStatSchema),
  completionBuckets: z.array(BucketSchema),
  scoreBuckets: z.array(BucketSchema),
  quality: DataQualitySchema,
  insights: z.array(InsightSchema),
  filter: z.string().nullable(),
  courseOptions: z.array(z.string()),
  courseCatalog: z.array(CourseCatalogItemSchema),
  dataset: DatasetMetaSchema,
});

export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

export const PitfallSchema = z.object({
  metric: z.string(),
  wrong: z.string(),
  reason: z.string(),
  correctHint: z.string(),
});

export type Pitfall = z.infer<typeof PitfallSchema>;

export const InsightsResponseSchema = z.object({
  overview: OverviewSchema,
  byCourse: z.array(CourseStatsSchema),
  insights: z.array(InsightSchema),
  pitfalls: z.array(PitfallSchema),
  dataset: DatasetMetaSchema,
  quality: DataQualitySchema,
  courseCatalog: z.array(CourseCatalogItemSchema),
});

export type InsightsResponse = z.infer<typeof InsightsResponseSchema>;