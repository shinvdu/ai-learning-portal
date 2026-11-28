# F041 登录/登出/会话

| 项 | 值 |
|---|---|
| 阶段 | M4 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 认证安全 |
| 依赖 | F020, F030, F044, F047 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

实现安全的会话登录、登出与多实例可用的会话存储。

## 行为与范围

- 登录顺序：限流→用户→启用→锁定→密码→验证状态→MFA。
- 会话 token 随机 256-bit，库存 SHA-256，Cookie HttpOnly/SameSite=Lax/7 天。
- 过期或停用用户会话惰性删除；登出删除当前会话。
- MFA 启用时先返回 5 分钟 challenge。

## 验收标准

- [ ] 正确密码登录 200 并设置 cookie；错误密码 401。
- [ ] 停用用户被登出；过期会话失效。
- [ ] 登出后旧 cookie 不再可用。
- [ ] 匿名 /auth/me 返回 {user:null}。

## 代码位置（计划）

- `apps/api/src/modules/auth/`
- `apps/api/src/middleware/session.ts`
- `apps/api/src/db/repositories/sessions.ts`

## 备注

会话存 PG，不用 Redis 作主存储。
