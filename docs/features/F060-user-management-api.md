# F060 用户管理 API

| 项 | 值 |
|---|---|
| 阶段 | M5 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 管理数据 |
| 依赖 | F041, F048 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

管理员可创建用户、改角色/状态/密码、解锁、重置 MFA、标记验证。

## 行为与范围

- 列表只返回安全字段与布尔状态。
- 创建用户默认已验证、活跃；邮箱唯一且大小写不敏感。
- PATCH 支持 name/role/active/password/unlock/emailVerified/resetMfa。
- 密码变更撤销目标会话（编辑自己时保留当前）。

## 验收标准

- [ ] 管理员 CRUD 全流程通过。
- [ ] 重复邮箱被拒绝。
- [ ] 停用立即撤销会话。
- [ ] 最后管理员与自操作保护生效。

## 代码位置（计划）

- `apps/api/src/modules/users/routes.ts`
- `apps/api/src/modules/users/service.ts`
- `apps/api/src/modules/users/schemas.ts`

## 备注

不支持修改邮箱（与 v1 一致）。
