import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildDashboard,
  buildInsights,
  byCourse,
  chapterStats,
  completionBuckets,
  dailyTrend,
  dataQuality,
  groupEnrollments,
  parseCsv,
  round1,
  scoreBuckets,
  summarize,
  validateRecord,
  weekdayStats,
} from '../src/index.js';
import type { ChapterRef, CourseStats, Enrollment, LearningRecord } from '../src/index.js';

const fixturePath = fileURLToPath(new URL('../../db/fixtures/learning_records.csv', import.meta.url));
const parsed = parseCsv(readFileSync(fixturePath, 'utf8'));
const courseNames = new Set(parsed.rows.map((row) => row.course_name));
const validated = parsed.rows.map((row) => validateRecord(row, courseNames));
const records: LearningRecord[] = validated.filter((result) => result.ok).map((result) => result.row);
const enrollments: Enrollment[] = groupEnrollments(records);
const overview = summarize(records, enrollments);
const courseStats: CourseStats[] = byCourse(records, enrollments);

const findByCourse = (name: string): CourseStats => {
  const found = courseStats.find((course) => course.course_name === name);
  if (!found) throw new Error(`missing course ${name}`);
  return found;
};

describe('analytics golden values (fixture learning_records.csv)', () => {
  it('parses all 177 fixture rows with zero validation errors', () => {
    expect(parsed.rows).toHaveLength(177);
    expect(validated.filter((result) => !result.ok)).toEqual([]);
    expect(records).toHaveLength(177);
  });

  it('matches the headline overview metrics exactly', () => {
    expect(overview).toEqual({
      students: 24,
      courses: 5,
      enrollments: 58,
      records: 177,
      avgCompletion: 74.3,
      avgScore: 86.4,
      scoredEnrollments: 53,
      noScoreEnrollments: 5,
      totalMinutes: 9916,
      totalHours: 165.3,
    });
  });

  it('matches every per-course metric', () => {
    const expected: Record<string, [learners: number, records: number, completion: number, avgScore: number]> = {
      '生成式 AI 基础': [11, 32, 81.8, 87.0],
      提示词工程入门: [16, 47, 81.3, 88.3],
      'Python 数据分析': [17, 53, 55.9, 81.1],
      'Web 前端开发实战': [6, 23, 76.2, 86.2],
      'AI 安全与负责任使用': [8, 22, 87.5, 90.3],
    };
    for (const [name, [learners, recordCount, completion, avgScore]] of Object.entries(expected)) {
      const stats = findByCourse(name);
      expect({ name, learners: stats.learners }).toEqual({ name, learners });
      expect(stats.records).toBe(recordCount);
      expect(stats.completion).toBe(completion);
      expect(stats.avgScore).toBe(avgScore);
    }
  });

  it('rounds halves up (81.25 -> 81.3) and keeps null/NaN as null', () => {
    expect(round1(81.25)).toBe(81.3);
    expect(round1(86.35)).toBe(86.4);
    expect(round1(null)).toBeNull();
    expect(round1(undefined)).toBeNull();
    expect(round1(Number.NaN)).toBeNull();
  });

  it('filters Python 数据分析 to 17 learners / 55.9% completion', () => {
    const python = findByCourse('Python 数据分析');
    expect(python.learners).toBe(17);
    expect(python.completion).toBe(55.9);
  });

  it('reports 30 chapters and a monotonic non-increasing inferred reach curve', () => {
    expect(courseStats.reduce((total, course) => total + course.chapters, 0)).toBe(30);

    const chapters: ChapterRef[] = Array.from({ length: 8 }, (_, i) => ({ idx: i + 1, title: `第 ${i + 1} 章` }));
    const stats = chapterStats(enrollments, 'Python 数据分析', chapters);
    expect(stats).toHaveLength(8);
    expect(stats[0]?.reachRate).toBe(100);
    for (let i = 1; i < stats.length; i += 1) {
      expect(stats[i]!.reachRate).toBeLessThanOrEqual(stats[i - 1]!.reachRate as number);
      expect(stats[i]!.reached).toBeLessThanOrEqual(stats[i - 1]!.reached);
    }
    expect(stats.map((stat) => stat.reached)).toEqual([17, 17, 17, 12, 8, 5, 0, 0]);
  });

  it('produces a continuous 14-day daily trend with the original totals', () => {
    const daily = dailyTrend(records);
    expect(daily).toHaveLength(14);
    expect(daily[0]?.date).toBe('2026-11-04');
    expect(daily[daily.length - 1]?.date).toBe('2026-11-17');
    expect(daily.reduce((total, point) => total + point.sessions, 0)).toBe(177);
    expect(daily.reduce((total, point) => total + point.minutes, 0)).toBe(9916);
  });

  it('derives weekday stats in UTC (2026-11-04 is a Wednesday)', () => {
    const weekday = weekdayStats(records);
    expect(weekday.map((day) => day.label)).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
    expect(weekday.reduce((total, day) => total + day.sessions, 0)).toBe(177);
    const wednesdaySessions = records.filter(
      (record) => new Date(`${record.learning_date}T00:00:00Z`).getUTCDay() === 3,
    ).length;
    expect(weekday.find((day) => day.label === '周三')?.sessions).toBe(wednesdaySessions);
  });

  it('builds completion and score buckets from enrollments', () => {
    const completion = completionBuckets(enrollments);
    expect(completion.map((bucket) => bucket.count)).toEqual([0, 5, 6, 22, 25]);
    expect(completion.reduce((total, bucket) => total + bucket.count, 0)).toBe(58);

    const scores = scoreBuckets(enrollments);
    expect(scores.map((bucket) => bucket.count)).toEqual([0, 2, 9, 22, 20]);
    expect(scores.reduce((total, bucket) => total + bucket.count, 0)).toBe(53);
  });

  it('reports data quality over the full date range', () => {
    const quality = dataQuality(records, enrollments, overview);
    expect(quality.dateFrom).toBe('2026-11-04');
    expect(quality.dateTo).toBe('2026-11-17');
    expect(quality.days).toBe(14);
    expect(quality.records).toBe(177);
    expect(quality.noScoreEnrollments).toBe(5);
  });

  it('generates the five stable insights in order', () => {
    const insights = buildInsights(records, enrollments, overview, courseStats);
    expect(insights.map((insight) => insight.id)).toEqual([
      'reach-vs-completion',
      'completion-score',
      'weekday-peak',
      'missing-score',
      'score-spread',
    ]);
    expect(insights.find((insight) => insight.id === 'missing-score')?.evidence).toContain('86.4');
  });

  it('buildDashboard composes the same sections', () => {
    const dashboard = buildDashboard(records, enrollments);
    expect(dashboard.overview).toEqual(overview);
    expect(dashboard.byCourse).toHaveLength(5);
    expect(dashboard.daily).toHaveLength(14);
    expect(dashboard.weekday).toHaveLength(7);
    expect(dashboard.completionBuckets).toHaveLength(5);
    expect(dashboard.scoreBuckets).toHaveLength(5);
    expect(dashboard.insights).toHaveLength(5);
  });

  it('keeps enrollment grouping free of student/course key collisions', () => {
    const tricky: LearningRecord[] = [
      { student_id: '1', course_name: '23', learning_date: '2026-11-04', learning_minutes: 10, chapters_done: 1, total_chapters: 2, quiz_score: 80 },
      { student_id: '12', course_name: '3', learning_date: '2026-11-04', learning_minutes: 10, chapters_done: 1, total_chapters: 2, quiz_score: 80 },
    ];
    expect(groupEnrollments(tricky)).toHaveLength(2);
  });
});