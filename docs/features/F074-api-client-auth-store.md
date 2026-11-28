# F074 API/CSRF 客户端与认证状态

| 项 | 值 |
|---|---|
| 阶段 | M6 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | Web 公共 |
| 依赖 | F070, F030 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

提供统一 API 客户端、CSRF 自动处理与认证状态管理。

## 行为与范围

- 变更请求自动带 X-CSRF-Token，缺失时先取 /auth/csrf。
- 统一 ApiError（status/payload/message）。
- 401 清空 auth 并把受保护路由跳登录。
- Pinia auth 提供 me/login/register/mfa/logout。

## 验收标准

- [ ] CSRF 缺失自动补发后请求成功。
- [ ] 401/403/429 显示正确文案。
- [ ] 刷新后会话状态恢复。
- [ ] 学习者看不到管理入口。

## 代码位置（计划）

- `apps/web/src/api/client.ts`
- `apps/web/src/api/endpoints.ts`
- `apps/web/src/stores/auth.ts`

## 备注

业务数据不放全局 store。
