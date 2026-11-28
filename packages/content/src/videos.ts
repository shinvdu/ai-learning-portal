/**
 * 视频配置：演示阶段统一使用同一段 8 秒占位视频，正式课程可替换。
 */

import type { ChapterVideoOverride, VideoConfig } from './types.js';

/** 示例视频：8 秒、无音频。正式课程可按课程替换 src/poster。 */
export const DEMO_VIDEO: VideoConfig = {
  src: '/assets/course-intro.mp4',
  poster: '/assets/course-intro-poster.jpg',
  duration: '00:08',
  durationText: '8 秒',
  label: '课程导览（占位视频）',
  note: '示例视频；正式课程可替换为讲师录播，页面布局与数据无需改动。',
};

/**
 * 章节视频：每个章节都有视频位，但演示阶段所有章节统一使用同一段 8 秒示例视频。
 * 需要替换某一章时，在 CHAPTER_VIDEOS 里加 `'C3-4': { src, poster, ... }` 即可。
 */
export const CHAPTER_VIDEO_DEFAULT: VideoConfig = {
  src: '/assets/course-intro.mp4',
  poster: '/assets/course-intro-poster.jpg',
  duration: '00:08',
  durationText: '8 秒',
  label: '本章示例视频（统一占位）',
  note: '所有章节统一使用同一段 8 秒示例视频，仅用于演示视频位；正式课程可按章节替换。',
  isPlaceholder: true,
};

export const CHAPTER_VIDEOS: Record<string, ChapterVideoOverride> = {};
