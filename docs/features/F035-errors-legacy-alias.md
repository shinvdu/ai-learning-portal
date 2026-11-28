# F035 错误封装与旧 /api 兼容

| 项 | 值 |
|---|---|
| 阶段 | M3 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | API 公共 |
| 依赖 | F030 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

统一错误响应与状态码，并在 /api/v1 之外保留旧 /api 薄别名。

## 行为与范围

- AppError(status, message, code, errors) 统一序列化。
- 旧 /api 挂同一 router，加 Deprecation 与 successor Link 头。
- 认证/权限/校验/限流/冲突错误文案与 v1 一致。
- 未知 API 路由返回 404 JSON；非 API 非 GET/HEAD 返回 405 文本。

## 验收标准

- [ ] 401/403/404/409/413/423/429 状态与文案逐项对齐。
- [ ] 旧 /api 与 /api/v1 行为一致且带弃用头。
- [ ] 500 不泄露堆栈，日志带 requestId。
- [ ] 错误详情不含密码/令牌。

## 代码位置（计划）

- `apps/api/src/lib/errors.ts`
- `apps/api/src/middleware/error-handler.ts`
- `apps/api/src/middleware/legacy-alias.ts`

## 备注

前端统一调用 /api/v1。
