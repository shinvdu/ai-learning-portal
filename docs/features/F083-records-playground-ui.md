# F083 记录演示面板

| 项 | 值 |
|---|---|
| 阶段 | M7 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | Web 认证管理 |
| 依赖 | F082, F062, F063, F064 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

在管理看板中提供学习记录的可视化编辑、CSV 导入导出与恢复示例数据。

## 行为与范围

- 搜索防抖、课程筛选、分页。
- 新增/编辑/删除记录，校验 quiz_score 可空。
- CSV 导入前确认整体替换；导出下载。
- 恢复示例数据需显式确认，生产受开关限制。

## 验收标准

- [ ] 修改一条记录后 KPI 与图表立即变化。
- [ ] 恢复后回到 74.3/86.4。
- [ ] 导入错误显示行号且不静默丢数据。
- [ ] 仅管理员可见。

## 代码位置（计划）

- `apps/web/src/components/dashboard/RecordPlayground.vue`
- `apps/web/src/components/dashboard/RecordDialog.vue`

## 备注

与 F063/F064 后端配套。
