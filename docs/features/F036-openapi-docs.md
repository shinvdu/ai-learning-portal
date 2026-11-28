# F036 OpenAPI 与 API 文档

| 项 | 值 |
|---|---|
| 阶段 | M3 |
| 优先级 | P1 |
| 状态 | 未开始（以追踪表为准） |
| 完成日期 | — |
| 模块 | API 公共 |
| 依赖 | F030, F031, F032, F033 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

由 zod 契约生成 OpenAPI 3.1 文档并提供交互式文档页。

## 行为与范围

- packages/contracts 定义请求/响应 schema 与 audit action 常量。
- 启动时生成 /api/v1/openapi.json。
- 非生产或 ENABLE_API_DOCS=1 时提供 Scalar UI。
- 文档包含 cookie 会话、CSRF 头、错误 envelope。

## 验收标准

- [ ] 文档生成无校验错误，覆盖全部路由。
- [ ] 匿名可读取 openapi.json（生产可按开关关闭）。
- [ ] 文档与实际响应 schema 抽样一致。
- [ ] audit action 列表与代码常量一致。

## 代码位置（计划）

- `packages/contracts/src/openapi.ts`
- `apps/api/src/lib/openapi.ts`

## 备注

P1，可与 M5 并行。
