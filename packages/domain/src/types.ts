/**
 * Shared domain types for the AI Learning Portal.
 *
 * The field names intentionally mirror the v1 analytics/csv output so that
 * API response shapes stay byte-for-byte compatible with the frozen v1.2.0
 * implementation.
 */

/** A single validated learning record (numbers already coerced). */
export interface LearningRecord {
  student_id: string;
  course_name: string;
  /** Strict calendar date, `YYYY-MM-DD`. */
  learning_date: string;
  learning_minutes: number;
  chapters_done: number;
  total_chapters: number;
  quiz_score: number | null;
}

/** A raw CSV row mapped by header name; every cell is a trimmed string. */
export type CsvRow = Record<string, string>;

/** Arbitrary raw input accepted by `validateRecord` (CSV row or request body). */
export type RecordInput = Record<string, unknown>;

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
}

export interface ValidationResult {
  ok: boolean;
  /** Normalized row; always populated even when `ok` is false. */
  row: LearningRecord;
  errors: string[];
}

/** One `student_id + course_name` enrollment, aggregated across its records. */
export interface Enrollment {
  student_id: string;
  course_name: string;
  max_ch: number;
  total: number;
  score: number | null;
  minutes: number;
  records: number;
  first_date: string;
  last_date: string;
  rate: number;
}

export interface Overview {
  students: number;
  courses: number;
  enrollments: number;
  records: number;
  /** Percentage, already rounded to one decimal, or null when indeterminate. */
  avgCompletion: number | null;
  avgScore: number | null;
  scoredEnrollments: number;
  noScoreEnrollments: number;
  totalMinutes: number;
  totalHours: number | null;
}

export interface CourseStats {
  course_name: string;
  learners: number;
  records: number;
  enrollments: number;
  completion: number | null;
  avgScore: number | null;
  scoredEnrollments: number;
  noScoreEnrollments: number;
  minutes: number;
  hours: number | null;
  chapters: number;
}

export interface DailyPoint {
  date: string;
  sessions: number;
  minutes: number;
  students: number;
}

export interface WeekdayStat {
  /** 周一 … 周日 */
  label: string;
  sessions: number;
  minutes: number;
  students: number;
}

export interface Bucket {
  label: string;
  count: number;
}

/** Minimal chapter descriptor needed for chapter reach statistics. */
export interface ChapterRef {
  idx: number;
  title: string;
}

export interface ChapterStat {
  idx: number;
  title: string;
  total: number;
  reached: number;
  notReached: number;
  reachRate: number | null;
  avgScoreReached: number | null;
  avgScoreNotReached: number | null;
  scoredReached: number;
  scoredNotReached: number;
}

export interface DataQuality {
  dateFrom: string | null;
  dateTo: string | null;
  days: number;
  records: number;
  enrollments: number;
  students: number;
  courses: number;
  noScoreEnrollments: number;
  scoredEnrollments: number;
}

export type InsightType = 'progress' | 'correlation' | 'timing' | 'quality' | 'comparison';

export interface Insight {
  id: string;
  type: InsightType;
  tag: string;
  title: string;
  evidence: string;
  action: string;
}

export interface Dashboard {
  overview: Overview;
  byCourse: CourseStats[];
  daily: DailyPoint[];
  weekday: WeekdayStat[];
  completionBuckets: Bucket[];
  scoreBuckets: Bucket[];
  quality: DataQuality;
  insights: Insight[];
}

/** Result of verifying a password against a stored hash. */
export interface PasswordVerifyResult {
  valid: boolean;
  /** True when the stored hash uses a legacy/outdated scheme and should be re-hashed. */
  needsRehash: boolean;
}