# F080 认证页面

| 项 | 值 |
|---|---|
| 阶段 | M7 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | Web 认证管理 |
| 依赖 | F070, F074, F040, F041, F042 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

复刻登录、注册、忘记密码、重置密码与邮箱验证页面及状态。

## 行为与范围

- 登录支持 MFA challenge 流程。
- 注册后显示验证邮件已发送。
- 重置/验证从 query 读取 token，按钮显式提交。
- 未验证登录提供重发入口。

## 验收标准

- [ ] 全部认证流程可完成。
- [ ] 错误/限流/锁定文案正确。
- [ ] 过期令牌显示可读错误。
- [ ] 表单可键盘操作并有错误关联。

## 代码位置（计划）

- `apps/web/src/views/LoginView.vue`
- `apps/web/src/views/RegisterView.vue`
- `apps/web/src/views/ForgotView.vue`
- `apps/web/src/views/ResetView.vue`
- `apps/web/src/views/VerifyView.vue`

## 备注

旧 hash 链接经路由守卫转换。
