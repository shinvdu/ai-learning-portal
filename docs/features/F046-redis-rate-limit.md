# F046 Redis 固定窗口限流

| 项 | 值 |
|---|---|
| 阶段 | M4 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 认证安全 |
| 依赖 | F030 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

用 Redis 实现跨实例一致的固定窗口限流，并保留成功清除语义。

## 行为与范围

- Lua INCR + PEXPIRE NX；键形如 rl:<scope>:<ip|userId>。
- 公共认证 20 次/10 分钟；账户操作 10 次/10 分钟。
- 成功注册/登录/MFA 清除对应桶。
- Redis 故障回退进程内 Map，并标记 readiness 降级。

## 验收标准

- [ ] 第 21 次请求返回 429；窗口重置后恢复。
- [ ] 两个 API 实例共享 Redis 时合计计数。
- [ ] 成功登录清除桶。
- [ ] Redis 停机时服务仍可用但 readiness 告警。

## 代码位置（计划）

- `apps/api/src/lib/rate-limit.ts`
- `apps/api/src/modules/auth/routes.ts`

## 备注

不使用 rate-limiter-flexible，保持窗口语义。
