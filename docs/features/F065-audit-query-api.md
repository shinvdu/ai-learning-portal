# F065 审计查询 API

| 项 | 值 |
|---|---|
| 阶段 | M5 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 管理数据 |
| 依赖 | F047, F060 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

管理员可按分页与 action 过滤查看审计记录。

## 行为与范围

- GET /admin/audit?limit=&offset=&action=。
- 默认 50 条，上限 200，按 id DESC。
- 返回 total/limit/offset/rows，details 解析为对象。
- 仅管理员可访问。

## 验收标准

- [ ] 分页与过滤正确。
- [ ] 默认与上限与 v1 一致。
- [ ] 学习者/匿名被拒绝。
- [ ] 返回字段与 UI 对齐。

## 代码位置（计划）

- `apps/api/src/modules/audit/routes.ts`
- `apps/api/src/modules/audit/service.ts`

## 备注

可加 actor/from/to 过滤（加法，不破坏兼容）。
