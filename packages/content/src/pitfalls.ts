/** 常见口径误区（演示与文档用）。 */

import type { Pitfall } from './types.js';

export const PITFALLS: Pitfall[] = [
  {
    metric: '学生人数',
    wrong: '177',
    reason: '直接数了 CSV 行数，没有按 student_id 去重。',
    correctHint: 'COUNT(DISTINCT student_id)',
  },
  {
    metric: '选课数',
    wrong: '177',
    reason: '把每条学习记录当成一次选课。',
    correctHint: 'COUNT(DISTINCT student_id + course_name)',
  },
  {
    metric: '平均完成率',
    wrong: '50.3%',
    reason: '按每条记录的 chapters_done ÷ total_chapters 求平均，没有先取每条选课的最大进度。',
    correctHint: '先 group by 选课取 max(chapters_done)，再对选课求平均',
  },
  {
    metric: '平均测验成绩',
    wrong: '偏低',
    reason: '把空成绩当成 0 分计入。58 条选课中有 5 条无成绩。',
    correctHint: '只统计 quiz_score 非空的选课',
  },
  {
    metric: '累计学习时长',
    wrong: '9,916',
    reason: '单位是分钟，未换算为小时。',
    correctHint: 'SUM(learning_minutes) ÷ 60',
  },
];
