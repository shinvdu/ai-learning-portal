# F033 看板与洞察 API

| 项 | 值 |
|---|---|
| 阶段 | M3 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | API 公共 |
| 依赖 | F030, F010, F021 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

输出 KPI、6 组图表数据、数据质量与动态洞察，数字全部由当前数据库计算。

## 行为与范围

- GET /dashboard?course= 支持单课程筛选。
- GET /insights 返回 overview/byCourse/insights/pitfalls/quality。
- 复用 packages/domain 纯函数，不在 SQL 重算。
- 课程筛选未知时回退全站并保持响应结构。

## 验收标准

- [ ] 全站与 Python 筛选的 KPI 精确。
- [ ] 6 组图表数据与 v1 一致。
- [ ] 洞察文案中的数字随数据变化。
- [ ] 响应包含 dataset 元信息。

## 代码位置（计划）

- `apps/api/src/modules/analytics/routes.ts`
- `apps/api/src/modules/analytics/service.ts`
- `apps/api/src/modules/analytics/dashboard.ts`
- `apps/api/src/modules/analytics/insights.ts`

## 备注

看板缓存默认关闭，后续可选 Redis。
