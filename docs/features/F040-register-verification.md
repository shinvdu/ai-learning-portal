# F040 注册与邮箱验证

| 项 | 值 |
|---|---|
| 阶段 | M4 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 认证安全 |
| 依赖 | F020, F030, F047, F049 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

复刻注册、邮件验证与开发/生产差异，保证账号安全与不可枚举。

## 行为与范围

- 开发环境注册后自动验证并登录；生产发送 24 小时验证链接。
- 验证链接为 hash 路由，必须点击按钮才调用 API。
- 重置/验证令牌单次使用且兑换时校验过期。
- 邮件发送失败保留账号并返回 502 MAIL_FAILED。

## 验收标准

- [ ] 开发注册 201 并建立会话；生产返回 verificationRequired。
- [ ] 未验证登录返回 403 EMAIL_UNVERIFIED。
- [ ] 过期或已用令牌被拒绝。
- [ ] 重发验证始终返回通用成功文案。

## 代码位置（计划）

- `apps/api/src/modules/auth/routes.ts`
- `apps/api/src/modules/auth/controller.ts`
- `apps/api/src/modules/auth/service.ts`
- `apps/api/src/modules/auth/tokens.ts`
- `apps/api/src/modules/auth/mail.ts`

## 备注

邮件扫描器预取 GET 不应触发验证。
