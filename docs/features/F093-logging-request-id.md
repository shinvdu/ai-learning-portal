# F093 日志与请求追踪

| 项 | 值 |
|---|---|
| 阶段 | M8 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 基础设施 |
| 依赖 | F030 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

结构化日志与请求 ID，支持排障与审计关联。

## 行为与范围

- pino JSON 输出，字段含 requestId/method/path/status/duration/userId。
- 接受合法入站 X-Request-Id，否则生成 UUID。
- 慢请求 >500ms 告警。
- 脱敏 cookie/authorization/password/token/code。

## 验收标准

- [ ] 响应头包含 X-Request-Id。
- [ ] 日志可检索同一请求全链路。
- [ ] 敏感字段不出现在日志。
- [ ] 日志级别由 LOG_LEVEL 控制。

## 代码位置（计划）

- `apps/api/src/lib/logger.ts`
- `apps/api/src/lib/request-id.ts`
- `apps/api/src/middleware/`

## 备注

不引入完整 APM。
