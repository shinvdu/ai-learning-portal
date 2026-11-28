/**
 * @portal/content 的类型定义。
 *
 * 内容数据全部依据课程讲义原文提炼，未加入原文之外的事实。
 * quiz.answer 是选项数组下标（从 0 开始）。
 */

/** 课程分类，与 v1 课程目录保持一致。 */
export type CourseCategory = 'AI 基础' | 'AI 应用' | '数据分析' | '软件开发';

/** 课程级别。 */
export type CourseLevel = '入门' | '进阶';

/** 示例视频：8 秒、无音频。正式课程可按课程替换 src/poster。 */
export type VideoConfig = {
  src: string;
  poster: string;
  duration: string;
  durationText: string;
  label: string;
  note: string;
  isPlaceholder?: boolean;
};

/** 单章视频覆盖项；仅需覆盖 src/poster 等字段。 */
export type ChapterVideoOverride = Partial<VideoConfig>;

export type Course = {
  id: string;
  name: string;
  lectureFile: string;
  category: CourseCategory;
  teacher: string;
  level: CourseLevel;
  badge: string;
  color: string;
  intro: string;
  video: VideoConfig;
  chapters: string[];
};

export type KnowledgeTerm = {
  term: string;
  definition: string;
};

export type KnowledgeFaq = {
  q: string;
  a: string;
};

export type KnowledgeQuiz = {
  q: string;
  options: string[];
  /** 正确选项下标，从 0 开始。 */
  answer: number;
  explanation: string;
  source: string;
};

export type KnowledgeReview = {
  before: string;
  after: string;
  note: string;
};

export type KnowledgeExcerpt = {
  chapter: string;
  text: string;
};

export type KnowledgePayload = {
  title: string;
  source: string;
  summary: string;
  objectives: string[];
  points: string[];
  terms: KnowledgeTerm[];
  faq: KnowledgeFaq[];
  quiz: KnowledgeQuiz[];
  review: KnowledgeReview;
  original: KnowledgeExcerpt[];
};

/** 以课程 id（C1…）为键的知识文档集合。 */
export type KnowledgeBase = Record<string, KnowledgePayload>;

/** 常见口径误区（演示与文档用）。 */
export type Pitfall = {
  metric: string;
  wrong: string;
  reason: string;
  correctHint: string;
};

/** 讲义解析结果：第 N 章及其正文。 */
export type ParsedChapter = {
  idx: number;
  title: string;
  body: string;
};
