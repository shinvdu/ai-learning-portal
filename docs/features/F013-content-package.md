# F013 内容包（课程/知识/视频/讲义）

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

把 5 门课程、知识库、视频配置、常见错误与讲义原文迁入独立内容包，保持内容与 v1 完全一致。

## 行为与范围

- COURSES/KNOWLEDGE/DEMO_VIDEO/CHAPTER_VIDEO_DEFAULT/CHAPTER_VIDEOS/PITFALLS 类型化导出。
- 5 个讲义 txt 归属内容包，解析第 N 章标题。
- 知识对象含 summary/objectives/points/terms/faq/quiz/review/original。
- 视频保持统一的 8 秒占位资源。

## 验收标准

- [ ] 5 门课标题/分类/教师/级别/颜色/章节数一致。
- [ ] 每门课 5 知识点、5 术语、3 FAQ、3 测验（含答案解析出处）。
- [ ] 30 个章节原文可解析且正文非空。
- [ ] 内容包不依赖数据库与前端框架。

## 代码位置（计划）

- `packages/content/src/courses.ts`
- `packages/content/src/knowledge.ts`
- `packages/content/src/videos.ts`
- `packages/content/src/pitfalls.ts`
- `packages/content/lectures/`

## 备注

页面不得写死参考数值。
