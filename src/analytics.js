/**
 * 指标口径（与项目文档 docs/ARCHITECTURE.md 一致）：
 *  - 学生人数：按 student_id 去重
 *  - 选课数：student_id + course_name 唯一组合
 *  - 完成率：每条选课取 max(chapters_done) / total_chapters，再对选课求平均
 *  - 平均测验成绩：每条选课取有成绩的最大值，只统计有成绩的选课（空成绩 ≠ 0 分）
 *  - 累计学习时长：learning_minutes 求和 ÷ 60
 * 所有页面数字都由这里从原始记录计算，不写死。
 */

// 半分进位（81.25 → 81.3），与手册/Excel 的展示口径一致；+1e-9 抵消浮点误差。
const round1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round((v + 1e-9) * 10) / 10);
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

export function groupEnrollments(records) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.student_id}${r.course_name}`;
    let e = map.get(key);
    if (!e) {
      e = {
        student_id: r.student_id,
        course_name: r.course_name,
        max_ch: 0,
        total: 0,
        score: null,
        minutes: 0,
        records: 0,
        first_date: r.learning_date,
        last_date: r.learning_date
      };
      map.set(key, e);
    }
    e.max_ch = Math.max(e.max_ch, Number(r.chapters_done));
    e.total = Math.max(e.total, Number(r.total_chapters));
    e.minutes += Number(r.learning_minutes);
    e.records += 1;
    if (r.learning_date < e.first_date) e.first_date = r.learning_date;
    if (r.learning_date > e.last_date) e.last_date = r.learning_date;
    if (r.quiz_score !== null && r.quiz_score !== undefined) {
      const s = Number(r.quiz_score);
      e.score = e.score === null ? s : Math.max(e.score, s);
    }
  }
  return [...map.values()].map((e) => ({
    ...e,
    rate: e.total > 0 ? e.max_ch / e.total : 0
  }));
}

export function summarize(records, enrollments) {
  const students = new Set(records.map((r) => r.student_id));
  const courses = new Set(records.map((r) => r.course_name));
  const scored = enrollments.filter((e) => e.score !== null);
  const totalMinutes = sum(records.map((r) => Number(r.learning_minutes) || 0));
  return {
    students: students.size,
    courses: courses.size,
    enrollments: enrollments.length,
    records: records.length,
    avgCompletion: round1((mean(enrollments.map((e) => e.rate)) ?? 0) * 100),
    avgScore: round1(mean(scored.map((e) => e.score))),
    scoredEnrollments: scored.length,
    noScoreEnrollments: enrollments.length - scored.length,
    totalMinutes,
    totalHours: round1(totalMinutes / 60)
  };
}

export function byCourse(records, enrollments, courseNames = []) {
  const names = new Set([...courseNames, ...records.map((r) => r.course_name)]);
  return [...names].map((name) => {
    const rs = records.filter((r) => r.course_name === name);
    const es = enrollments.filter((e) => e.course_name === name);
    const scored = es.filter((e) => e.score !== null);
    return {
      course_name: name,
      learners: new Set(rs.map((r) => r.student_id)).size,
      records: rs.length,
      enrollments: es.length,
      completion: round1((mean(es.map((e) => e.rate)) ?? 0) * 100),
      avgScore: round1(mean(scored.map((e) => e.score))),
      scoredEnrollments: scored.length,
      noScoreEnrollments: es.length - scored.length,
      minutes: sum(rs.map((r) => Number(r.learning_minutes) || 0)),
      hours: round1(sum(rs.map((r) => Number(r.learning_minutes) || 0)) / 60),
      chapters: Math.max(0, ...rs.map((r) => Number(r.total_chapters) || 0))
    };
  });
}

/** 补齐没有记录的日期，返回连续日期序列。 */
export function dailyTrend(records) {
  if (records.length === 0) return [];
  const dates = records.map((r) => r.learning_date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  const byDate = new Map();
  for (const r of records) {
    let d = byDate.get(r.learning_date);
    if (!d) {
      d = { date: r.learning_date, sessions: 0, minutes: 0, students: new Set() };
      byDate.set(r.learning_date, d);
    }
    d.sessions += 1;
    d.minutes += Number(r.learning_minutes) || 0;
    d.students.add(r.student_id);
  }
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const d = byDate.get(date);
    out.push({
      date,
      sessions: d?.sessions ?? 0,
      minutes: d?.minutes ?? 0,
      students: d ? d.students.size : 0
    });
  }
  return out;
}

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEK_INDEX = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }; // getUTCDay → 周一为 0

export function weekdayStats(records) {
  const days = WEEK_LABELS.map((label) => ({ label, sessions: 0, minutes: 0, students: new Set() }));
  for (const r of records) {
    const wd = new Date(`${r.learning_date}T00:00:00Z`).getUTCDay();
    const d = days[WEEK_INDEX[wd]];
    d.sessions += 1;
    d.minutes += Number(r.learning_minutes) || 0;
    d.students.add(r.student_id);
  }
  return days.map((d) => ({ label: d.label, sessions: d.sessions, minutes: d.minutes, students: d.students.size }));
}

export function completionBuckets(enrollments) {
  const labels = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];
  const counts = labels.map(() => 0);
  for (const e of enrollments) {
    const pct = e.rate * 100;
    const i = Math.min(4, Math.max(0, Math.floor(pct / 20)));
    counts[i] += 1;
  }
  return labels.map((label, i) => ({ label, count: counts[i] }));
}

export function scoreBuckets(enrollments) {
  const labels = ['<60', '60–70', '70–80', '80–90', '90–100'];
  const counts = labels.map(() => 0);
  for (const e of enrollments) {
    if (e.score === null) continue;
    const s = e.score;
    const i = s < 60 ? 0 : s < 70 ? 1 : s < 80 ? 2 : s < 90 ? 3 : 4;
    counts[i] += 1;
  }
  return labels.map((label, i) => ({ label, count: counts[i] }));
}

/**
 * 章节到达率（推断口径）。
 * 原始 CSV 只有“完成章节总数”，没有逐章记录。这里假设学生按顺序学习：
 * 某条选课的 max(chapters_done) >= 章节序号，即视为到达该章。
 * 页面必须明确标注“推断值”，不能当作原始逐章数据。
 */
export function chapterStats(enrollments, courseName, chapters) {
  const es = enrollments.filter((e) => e.course_name === courseName);
  const total = es.length;
  return chapters
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((ch) => {
      const reached = es.filter((e) => e.max_ch >= ch.idx);
      const notReached = es.filter((e) => e.max_ch < ch.idx);
      const scoredReached = reached.filter((e) => e.score !== null);
      const scoredNotReached = notReached.filter((e) => e.score !== null);
      return {
        idx: ch.idx,
        title: ch.title,
        total,
        reached: reached.length,
        notReached: notReached.length,
        reachRate: round1(total ? (reached.length / total) * 100 : 0),
        avgScoreReached: round1(mean(scoredReached.map((e) => e.score))),
        avgScoreNotReached: round1(mean(scoredNotReached.map((e) => e.score))),
        scoredReached: scoredReached.length,
        scoredNotReached: scoredNotReached.length
      };
    });
}

export function dataQuality(records, enrollments, overview) {
  const dates = records.map((r) => r.learning_date).sort();
  return {
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    days: dates.length ? Math.round((Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86400000) + 1 : 0,
    records: overview.records,
    enrollments: overview.enrollments,
    students: overview.students,
    courses: overview.courses,
    noScoreEnrollments: overview.noScoreEnrollments,
    scoredEnrollments: overview.scoredEnrollments
  };
}

/** 由数据动态生成的洞察（不写死结论数字）。 */
export function buildInsights(records, enrollments, overview, courseStats) {
  const insights = [];
  const active = courseStats.filter((c) => c.learners > 0);
  if (active.length === 0) return insights;

  const most = active.reduce((a, b) => (b.learners > a.learners ? b : a));
  const lowest = active.reduce((a, b) => (b.completion < a.completion ? b : a));
  const best = active.reduce((a, b) => (b.completion > a.completion ? b : a));

  if (most.learners >= 2) {
    insights.push({
      id: 'reach-vs-completion',
      type: 'progress',
      tag: '学习进度',
      title: `${most.course_name} 学习人数最多，完成率${most.course_name === lowest.course_name ? '却最低' : '仍需关注'}`,
      evidence: `${most.course_name} 有 ${most.learners} 名学习者（全站最多），平均完成率 ${most.completion}%${
        most.course_name === lowest.course_name ? `，为五门课中最低` : ''
      }；完成率最高的 ${best.course_name} 为 ${best.completion}%。`,
      action:
        '建议优先检查该课程前几章的难度与学习引导，把长章节拆成更小的学习单元，并在章末增加进度提示。'
    });
  }

  const high = enrollments.filter((e) => e.score !== null && e.rate >= 0.8);
  const low = enrollments.filter((e) => e.score !== null && e.rate < 0.8);
  if (high.length >= 2 && low.length >= 2) {
    const hi = mean(high.map((e) => e.score));
    const lo = mean(low.map((e) => e.score));
    insights.push({
      id: 'completion-score',
      type: 'correlation',
      tag: '相关性',
      title: '完成度更高的选课，测验成绩也更高',
      evidence: `完成率 ≥80% 的 ${high.length} 条选课平均分 ${round1(hi)}；完成率 <80% 的 ${low.length} 条选课平均分 ${round1(
        lo
      )}，相差 ${round1(hi - lo)} 分。`,
      action: '可将“完成率达到 80%”设为本期学习目标，并在完成率偏低的课程中增加阶段测验与提醒（相关不等于因果）。'
    });
  }

  const wd = weekdayStats(records);
  const peak = wd.reduce((a, b) => (b.sessions > a.sessions ? b : a));
  const weekend = wd[5].sessions + wd[6].sessions;
  const totalSessions = sum(wd.map((d) => d.sessions));
  if (totalSessions > 0) {
    insights.push({
      id: 'weekday-peak',
      type: 'timing',
      tag: '时间规律',
      title: `学习活动集中在${peak.label}`,
      evidence: `${peak.label}学习人次最高（${peak.sessions} 人次）；周末合计 ${weekend} 人次，占全部的 ${round1(
        (weekend / totalSessions) * 100
      )}%。`,
      action: `可把学习提醒与新测验安排在${peak.label}前后；周末活跃度低，不建议把截止时间放在周末。`
    });
  }

  if (overview.noScoreEnrollments > 0 && overview.scoredEnrollments > 0) {
    const totalScore = sum(enrollments.filter((e) => e.score !== null).map((e) => e.score));
    const ifZero = totalScore / enrollments.length;
    insights.push({
      id: 'missing-score',
      type: 'quality',
      tag: '数据质量',
      title: '空成绩不等于 0 分',
      evidence: `${overview.enrollments} 条选课中有 ${overview.noScoreEnrollments} 条没有测验成绩。当前平均分 ${overview.avgScore} 只统计了 ${overview.scoredEnrollments} 条有成绩的选课；若把空成绩按 0 分计入，会降到约 ${round1(ifZero)}。`,
      action: '看板应同时标注“有成绩样本数”，把“未参加测验”和“得 0 分”分开统计，避免误判教学质量。'
    });
  }

  const scoredCourses = active.filter((c) => c.avgScore !== null);
  if (scoredCourses.length >= 2) {
    const scoreBest = scoredCourses.reduce((a, b) => (b.avgScore > a.avgScore ? b : a));
    const scoreWorst = scoredCourses.reduce((a, b) => (b.avgScore < a.avgScore ? b : a));
    if (scoreBest.course_name !== scoreWorst.course_name) {
      insights.push({
        id: 'score-spread',
        type: 'comparison',
        tag: '课程对比',
        title: '课程之间成绩差距明显',
        evidence: `${scoreBest.course_name} 平均分最高（${scoreBest.avgScore}，${scoreBest.scoredEnrollments} 条有成绩选课）；${
          scoreWorst.course_name
        } 最低（${scoreWorst.avgScore}），相差 ${round1(scoreBest.avgScore - scoreWorst.avgScore)} 分。`,
        action: '可对比两门课的讲义难度、测验题量与学习节奏，把高分课程的组织方式复用到低分课程。'
      });
    }
  }

  return insights;
}

export function buildDashboard(records, enrollments, courseNames = []) {
  const overview = summarize(records, enrollments);
  const courseStats = byCourse(records, enrollments, courseNames);
  const insights = buildInsights(records, enrollments, overview, courseStats);
  return {
    overview,
    byCourse: courseStats,
    daily: dailyTrend(records),
    weekday: weekdayStats(records),
    completionBuckets: completionBuckets(enrollments),
    scoreBuckets: scoreBuckets(enrollments),
    quality: dataQuality(records, enrollments, overview),
    insights
  };
}