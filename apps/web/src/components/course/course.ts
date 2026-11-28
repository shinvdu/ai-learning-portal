/** Small helpers shared by the public course pages (ported from v1). */
import type { CourseMeta, CourseStats } from '@/api/types';

export const DEFAULT_COURSE_COLOR = '#2f78c4';

export function courseColor(
  course: Pick<CourseMeta, 'color'> | null | undefined,
): string {
  return course?.color || DEFAULT_COURSE_COLOR;
}

/** Badge text: the configured short label, else the first two characters. */
export function courseBadge(
  course: Pick<CourseMeta, 'badge' | 'name'>,
): string {
  return course.badge || course.name.slice(0, 2);
}

/** Completion clamped to 0–100 for meters; invalid/null becomes 0. */
export function completionOf(
  stats: Pick<CourseStats, 'completion'> | null | undefined,
): number {
  const n = Number(stats?.completion);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** `media duration` fallback: prefer the human text, then the raw duration. */
export function videoDuration(video: { durationText?: string; duration?: string }): string {
  return video.durationText || video.duration || '';
}