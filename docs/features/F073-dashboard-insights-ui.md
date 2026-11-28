# F073 看板与洞察页面（ECharts）

| 项 | 值 |
|---|---|
| 阶段 | M6 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | Web 公共 |
| 依赖 | F070, F033 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

用 ECharts 复刻 5 KPI + 6 图表 + 洞察与公式说明，并支持课程筛选和紧凑模式。

## 行为与范围

- 课程筛选写入 query，刷新保持。
- 图表含 tooltip、无障碍摘要、空状态。
- ≤720px 使用紧凑布局。
- 洞察卡片展示证据与行动建议。

## 验收标准

- [ ] 全站 KPI 24/5/58/74.3/86.4/165.3。
- [ ] Python 筛选 17/55.9%。
- [ ] 6 张图与 v1 数据一致。
- [ ] 390px 下图表可读且无溢出。

## 代码位置（计划）

- `apps/web/src/views/DashboardView.vue`
- `apps/web/src/views/InsightsView.vue`
- `apps/web/src/components/charts/`

## 备注

图表按需引入，避免整包 ECharts。
