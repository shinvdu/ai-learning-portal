# F032 章节与知识 API

| 项 | 值 |
|---|---|
| 阶段 | M3 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | API 公共 |
| 依赖 | F030, F021 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

提供章节正文/视频/测验/到达率与知识中心内容接口。

## 行为与范围

- GET /chapters/:courseId/:idx 返回章节、课程、视频、统计、相关测验、prev/next。
- GET /knowledge/:id 返回课程摘要与知识 payload，缺失返回 null。
- 章节到达率标注为推断值。
- 章节空号时 prev/next 只指向存在的相邻索引。

## 验收标准

- [ ] 30 个章节均可访问，正文非空。
- [ ] 第 1 章到达率 100%，到达率单调不增。
- [ ] 知识中心 5 知识点/5 术语/3 FAQ/3 测验完整。
- [ ] 不存在的章节/课程返回 404。

## 代码位置（计划）

- `apps/api/src/modules/chapters/`
- `apps/api/src/modules/knowledge/`
- `apps/api/src/db/repositories/chapters.ts`

## 备注

测验答案与解析来自内容包原文。
