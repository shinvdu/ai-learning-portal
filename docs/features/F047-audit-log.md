# F047 审计日志

| 项 | 值 |
|---|---|
| 阶段 | M4 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 认证安全 |
| 依赖 | F020, F030 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

对认证、用户、课程、数据操作写入稳定事件名的审计记录。

## 行为与范围

- audit_log 只追加，字段含 actor/action/target/ip/details。
- 事件名常量集中在 packages/contracts。
- 写失败只告警，不影响主流程。
- details 不含密码、令牌、恢复码。

## 验收标准

- [ ] 登录/失败/锁定/重置/MFA/管理操作均产生记录。
- [ ] 事件名与 v1 列表完全一致。
- [ ] 审计查询可按 action 精确过滤。
- [ ] 写失败注入测试不影响主流程。

## 代码位置（计划）

- `apps/api/src/modules/audit/service.ts`
- `apps/api/src/db/repositories/audit.ts`
- `packages/contracts/src/audit-actions.ts`

## 备注

保留期与归档后续。
