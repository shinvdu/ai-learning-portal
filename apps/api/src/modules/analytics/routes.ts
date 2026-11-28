/**
 * Public analytics API (F033): `GET /dashboard?course=` and `GET /insights`.
 *
 * Both handlers read raw records plus the course catalogue from PostgreSQL and
 * delegate every metric to `@portal/domain` so v1 keys, rounding, chart groups,
 * insight copy and dataset metadata stay identical. Filtering is by exact
 * course name; an unknown name falls back to the whole site without changing
 * the envelope.
 */
import { Router, type Request, type Response } from 'express';
import {
  DashboardQuerySchema,
  type DashboardResponse,
  type InsightsResponse,
} from '@portal/contracts';
import { PITFALLS } from '@portal/content';
import {
  buildDashboard,
  buildInsights,
  byCourse,
  dataQuality,
  groupEnrollments,
  summarize,
} from '@portal/domain';
import { appDeps } from '../../lib/types.js';
import {
  getAnalyticsSnapshot,
  type AnalyticsSnapshot,
  type AnalyticsCourse,
} from '../../db/repositories/analytics.js';

export const analyticsRouter = Router();

/**
 * Express parses repeated query keys as arrays; v1 `URLSearchParams.get` used
 * the first value. Return that first string, treating empty as absent.
 */
function firstQueryString(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first : undefined;
}

function courseCatalog(courses: readonly AnalyticsCourse[]): AnalyticsCourse[] {
  return courses.map(({ id, name, color, badge }) => ({ id, name, color, badge }));
}

function dashboardPayload(
  snapshot: AnalyticsSnapshot,
  requestedCourse: string | undefined,
): DashboardResponse {
  const courseNames = snapshot.courses.map((course) => course.name);
  const known = requestedCourse !== undefined && courseNames.includes(requestedCourse);
  // Unknown (renamed/deleted) course: serve the whole site, v1 client fallback.
  const courseFilter = known ? requestedCourse : undefined;

  const records = courseFilter
    ? snapshot.records.filter((record) => record.course_name === courseFilter)
    : snapshot.records;
  const enrollments = groupEnrollments(records);
  const dashboard = buildDashboard(records, enrollments, courseNames);

  const byCourseStats = courseFilter
    ? dashboard.byCourse.filter((course) => course.course_name === courseFilter)
    : dashboard.byCourse;

  return {
    overview: dashboard.overview,
    byCourse: byCourseStats,
    daily: dashboard.daily,
    weekday: dashboard.weekday,
    completionBuckets: dashboard.completionBuckets,
    scoreBuckets: dashboard.scoreBuckets,
    quality: dashboard.quality,
    insights: dashboard.insights,
    filter: courseFilter ?? null,
    courseOptions: courseNames,
    courseCatalog: courseCatalog(snapshot.courses),
    dataset: snapshot.dataset,
  };
}

function insightsPayload(snapshot: AnalyticsSnapshot): InsightsResponse {
  const records = snapshot.records;
  const enrollments = groupEnrollments(records);
  const overview = summarize(records, enrollments);
  const courseNames = snapshot.courses.map((course) => course.name);
  const courseStats = byCourse(records, enrollments, courseNames);

  return {
    overview,
    byCourse: courseStats,
    insights: buildInsights(records, enrollments, overview, courseStats),
    pitfalls: PITFALLS,
    dataset: snapshot.dataset,
    quality: dataQuality(records, enrollments, overview),
    courseCatalog: courseCatalog(snapshot.courses),
  };
}

analyticsRouter.get('/dashboard', async (req: Request, res: Response) => {
  const parsed = DashboardQuerySchema.safeParse({
    course: firstQueryString(req.query.course),
  });
  const requestedCourse = parsed.success ? parsed.data.course : undefined;
  const snapshot = await getAnalyticsSnapshot(appDeps(req).db);
  res.json(dashboardPayload(snapshot, requestedCourse));
});

analyticsRouter.get('/insights', async (req: Request, res: Response) => {
  const snapshot = await getAnalyticsSnapshot(appDeps(req).db);
  res.json(insightsPayload(snapshot));
});