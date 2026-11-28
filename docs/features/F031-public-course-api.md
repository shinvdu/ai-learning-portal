# F031 公共课程目录与详情 API

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

复刻课程广场与课程详情所需的公共聚合接口，保持响应形状与排序。

## 行为与范围

- GET /meta、/courses?q=&category=、/courses/:idOrName。
- 课程含 stats（学习人数/记录/完成率/平均分/章节数）。
- 支持 ID 或课程名查询，未知返回 404。
- 仅返回聚合数据，不泄露原始记录。

## 验收标准

- [ ] 5 门课与 golden 分课程值一致。
- [ ] 分类筛选/搜索/排序与 v1 一致。
- [ ] 未知课程 404 文案一致。
- [ ] 匿名可访问。

## 代码位置（计划）

- `apps/api/src/modules/courses/routes.ts`
- `apps/api/src/modules/courses/service.ts`
- `apps/api/src/modules/courses/schemas.ts`
- `apps/api/src/db/repositories/courses.ts`

## 备注

course_name 由 join 解析。
