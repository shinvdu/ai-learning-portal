import { describe, expect, it } from 'vitest';
import {
  CHAPTER_VIDEO_DEFAULT,
  CHAPTER_VIDEOS,
  COURSES,
  DEMO_VIDEO,
  PITFALLS,
  type VideoConfig,
} from '@portal/content';

const EXPECTED_CHAPTERS: Record<string, number> = {
  C1: 6,
  C2: 5,
  C3: 8,
  C4: 7,
  C5: 4,
};

const COURSE_IDS = ['C1', 'C2', 'C3', 'C4', 'C5'];

describe('COURSES', () => {
  it('contains exactly 5 courses with stable ids', () => {
    expect(COURSES).toHaveLength(5);
    expect(COURSES.map((course) => course.id)).toEqual(COURSE_IDS);
  });

  it('keeps the expected chapter counts', () => {
    const counts = Object.fromEntries(COURSES.map((course) => [course.id, course.chapters.length]));
    expect(counts).toEqual(EXPECTED_CHAPTERS);
  });

  it('fills every catalog field with non-empty Chinese content', () => {
    for (const course of COURSES) {
      expect(course.name.length).toBeGreaterThan(0);
      expect(course.lectureFile).toMatch(/^课程讲义_.+\.txt$/);
      expect(['AI 基础', 'AI 应用', '数据分析', '软件开发']).toContain(course.category);
      expect(['入门', '进阶']).toContain(course.level);
      expect(course.teacher.length).toBeGreaterThan(0);
      expect(course.badge.length).toBeGreaterThan(0);
      expect(course.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(course.intro.length).toBeGreaterThan(0);
      expect(new Set(course.chapters).size).toBe(course.chapters.length);
    }
  });

  it('uses the shared 8 second demo video', () => {
    for (const course of COURSES) {
      expect(course.video).toEqual(DEMO_VIDEO);
    }
    expect(DEMO_VIDEO).toEqual<VideoConfig>({
      src: '/assets/course-intro.mp4',
      poster: '/assets/course-intro-poster.jpg',
      duration: '00:08',
      durationText: '8 秒',
      label: '课程导览（占位视频）',
      note: '示例视频；正式课程可替换为讲师录播，页面布局与数据无需改动。',
    });
  });
});

describe('video configuration', () => {
  it('derives the chapter placeholder from the demo video', () => {
    expect(CHAPTER_VIDEO_DEFAULT).toMatchObject({
      src: DEMO_VIDEO.src,
      poster: DEMO_VIDEO.poster,
      duration: DEMO_VIDEO.duration,
      durationText: DEMO_VIDEO.durationText,
    });
    expect(CHAPTER_VIDEO_DEFAULT.isPlaceholder).toBe(true);
    expect(CHAPTER_VIDEO_DEFAULT.label).toBe('本章示例视频（统一占位）');
  });

  it('starts with no per-chapter overrides', () => {
    expect(Object.keys(CHAPTER_VIDEOS)).toHaveLength(0);
  });
});

describe('PITFALLS', () => {
  it('documents the five common metric mistakes', () => {
    expect(PITFALLS).toHaveLength(5);
    for (const pitfall of PITFALLS) {
      expect(pitfall.metric.length).toBeGreaterThan(0);
      expect(pitfall.wrong.length).toBeGreaterThan(0);
      expect(pitfall.reason.length).toBeGreaterThan(0);
      expect(pitfall.correctHint.length).toBeGreaterThan(0);
    }
  });
});
