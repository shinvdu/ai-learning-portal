# F030 Express 应用工厂与中间件链

| 项 | 值 |
|---|---|
| 阶段 | M3 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | API 公共 |
| 依赖 | F020 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

提供可测试的 createApp(deps)，按约定顺序装配安全、解析、会话、限流、角色与错误处理中间件。

## 行为与范围

- 依赖注入 db/redis/mailer/config，便于 supertest 与多实例。
- request-id、pino、helmet、Cache-Control、2MB body、Origin、CSRF、cookie、session 顺序固定。
- 统一 AppError 与错误 envelope；未知 API 固定 404 文案。
- 生产配置 fail-fast，开发提供安全默认。

## 验收标准

- [ ] createApp 不监听端口即可被 supertest 调用。
- [ ] 中间件顺序测试通过（Origin/CSRF/body/session）。
- [ ] 未知 API 返回 {error:接口不存在}。
- [ ] 2MB 超限返回 413，非法 JSON 返回 400。

## 代码位置（计划）

- `apps/api/src/app.ts`
- `apps/api/src/config.ts`
- `apps/api/src/lib/errors.ts`
- `apps/api/src/middleware/`

## 备注

Express 5 通配符语法与 SPA fallback 需专门测试。
