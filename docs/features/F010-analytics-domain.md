# F010 分析域包与 golden 测试

| 项 | 值 |
|---|---|
| 阶段 | M1 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 领域层 |
| 依赖 | F001 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

把 v1 的指标与洞察算法逐函数移植为无框架依赖的 TypeScript 纯函数，作为全站唯一口径来源。

## 行为与范围

- groupEnrollments/summarize/byCourse/dailyTrend/weekdayStats/buckets/chapterStats/buildInsights 1:1 移植。
- round1 保留 +1e-9 半分进位；空成绩不计 0。
- 章节到达率保持推断值语义与文案。
- 输入输出类型化，不依赖数据库、Express 或 Vue。

## 验收标准

- [ ] golden：24/5/58/177/74.3/86.4/5 无成绩/9916 分钟/165.3 小时。
- [ ] 五门课的分课程值逐项一致。
- [ ] 81.25 显示为 81.3；Python 筛选 17 人/55.9%。
- [ ] 在非 UTC 时区下结果不变。

## 代码位置（计划）

- `packages/domain/src/analytics.ts`
- `packages/domain/src/rounding.ts`
- `packages/domain/src/types.ts`
- `packages/domain/test/analytics.golden.test.ts`

## 备注

v2 不在 SQL 中重算指标。
