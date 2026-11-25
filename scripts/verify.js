/**
 * 口径校验：重置为种子数据后，核对手册第 5 章的参考值。
 * 注意：会清空手工修改，恢复 data/learning_records.csv。
 *
 * 用法：node scripts/verify.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb, resetRecords, getAllRecords, getCourseMeta, getKnowledge, getChapterRows, ROOT } from '../src/db.js';
import { groupEnrollments, summarize, byCourse, chapterStats } from '../src/analytics.js';
import { CHAPTER_VIDEO_DEFAULT, CHAPTER_VIDEOS } from '../src/content.js';

const db = openDb();
const seed = resetRecords(db);
if (!seed.ok) {
  console.error('种子导入失败', seed);
  process.exit(1);
}

const records = getAllRecords(db);
const enrollments = groupEnrollments(records);
const overview = summarize(records, enrollments);
const courses = getCourseMeta(db);
const stats = byCourse(records, enrollments, courses.map((c) => c.name));

const expectedOverview = {
  students: 24,
  courses: 5,
  enrollments: 58,
  avgCompletion: 74.3,
  avgScore: 86.4,
  noScoreEnrollments: 5,
  totalHours: 165.3
};

const expectedCourses = {
  '生成式 AI 基础': { learners: 11, records: 32, completion: 81.8, avgScore: 87.0 },
  '提示词工程入门': { learners: 16, records: 47, completion: 81.3, avgScore: 88.3 },
  'Python 数据分析': { learners: 17, records: 53, completion: 55.9, avgScore: 81.1 },
  'Web 前端开发实战': { learners: 6, records: 23, completion: 76.2, avgScore: 86.2 },
  'AI 安全与负责任使用': { learners: 8, records: 22, completion: 87.5, avgScore: 90.3 }
};

let failures = 0;
function check(label, actual, expected, tol = 0.05) {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) <= tol : actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label}: ${actual}${ok ? '' : `  (期望 ${expected})`}`);
}

console.log('\n— 整体指标 —');
for (const [k, v] of Object.entries(expectedOverview)) check(k, overview[k], v);

console.log('\n— 分课程指标 —');
for (const [name, exp] of Object.entries(expectedCourses)) {
  const s = stats.find((x) => x.course_name === name);
  if (!s) {
    failures++;
    console.log(`❌ 缺少课程 ${name}`);
    continue;
  }
  check(`${name} 学习人数`, s.learners, exp.learners);
  check(`${name} 学习记录数`, s.records, exp.records);
  check(`${name} 平均完成率`, s.completion, exp.completion);
  check(`${name} 平均成绩`, s.avgScore, exp.avgScore);
}

console.log('\n— 附加口径 —');
check('记录行数', overview.records, 177);
check('有成绩选课数', overview.scoredEnrollments, 53);
check('累计分钟', overview.totalMinutes, 9916);

console.log('\n— 知识中心完整性 —');
for (const c of courses) {
  const k = getKnowledge(db, c.id);
  if (!k) {
    failures++;
    console.log(`❌ ${c.name} 缺少知识文档`);
    continue;
  }
  const summaryLen = Array.from(k.summary).length;
  check(`${c.name} 摘要字数 ≤200`, summaryLen <= 200, true);
  check(`${c.name} 知识点数`, k.points.length, 5);
  check(`${c.name} 术语数`, k.terms.length, 5);
  check(`${c.name} FAQ 数`, k.faq.length, 3);
  check(`${c.name} 测验数`, k.quiz.length, 3);
  const quizOk = k.quiz.every((q) => q.options.length === 4 && q.answer >= 0 && q.answer < 4 && q.explanation && q.source);
  check(`${c.name} 测验答案/解析/出处完整`, quizOk, true);
  check(`${c.name} 人工修正记录完整`, Boolean(k.review?.before && k.review?.after && k.review?.note), true);
  check(`${c.name} 原文摘录数 ≥3`, k.original.length >= 3, true);
  const maxCh = Math.max(...records.filter((r) => r.course_name === c.name).map((r) => r.total_chapters));
  check(`${c.name} 章节数与数据一致`, c.chapters.length, maxCh);
  check(`${c.name} 已配置视频`, Boolean(c.video?.src && c.video?.poster), true);

  const chapterRows = getChapterRows(db, c.id);
  check(`${c.name} 章节原文数`, chapterRows.length, c.chapters.length);
  check(`${c.name} 章节标题与目录一致`, chapterRows.every((ch, i) => ch.title === c.chapters[i]), true);
  check(`${c.name} 章节正文非空`, chapterRows.every((ch) => ch.body.length > 30), true);
  const cs = chapterStats(enrollments, c.name, chapterRows);
  if (cs.length > 0) {
    check(`${c.name} 第 1 章到达率 100%`, cs[0].reachRate, 100);
    check(
      `${c.name} 章节到达率单调不增`,
      cs.every((s, i) => i === 0 || s.reachRate <= cs[i - 1].reachRate),
      true
    );
  }
}

console.log('\n— 视频资源 —');
const videoPath = path.join(ROOT, 'public', 'assets', 'course-intro.mp4');
const posterPath = path.join(ROOT, 'public', 'assets', 'course-intro-poster.jpg');
check('占位视频存在且 >100KB', fs.existsSync(videoPath) && fs.statSync(videoPath).size > 100 * 1024, true);
check('视频封面存在且 >10KB', fs.existsSync(posterPath) && fs.statSync(posterPath).size > 10 * 1024, true);
check('章节默认视频已配置', Boolean(CHAPTER_VIDEO_DEFAULT?.src && CHAPTER_VIDEO_DEFAULT?.poster && CHAPTER_VIDEO_DEFAULT?.isPlaceholder), true);
check(
  '章节视频覆盖配置合法',
  Object.values(CHAPTER_VIDEOS).every((v) => Boolean(v?.src && v?.poster)),
  true
);

console.log(`\n${failures === 0 ? '全部通过 ✅' : `${failures} 项不一致 ❌`}\n`);
db.close();
process.exit(failures === 0 ? 0 : 1);