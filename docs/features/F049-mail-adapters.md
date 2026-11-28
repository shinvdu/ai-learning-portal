# F049 邮件适配器

| 项 | 值 |
|---|---|
| 阶段 | M4 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 认证安全 |
| 依赖 | F001, F047 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

抽象邮件发送，生产默认 webhook，开发用控制台，预留 SMTP。

## 行为与范围

- webhook 契约 POST {from,to,subject,text,html}，Bearer token，10 秒超时。
- console 仅开发/测试；生产拒绝。
- SMTP 通过 SMTP_URL 可选启用（P1）。
- 链接使用 PUBLIC_BASE_URL 与旧 hash 路径，前端负责重定向。

## 验收标准

- [ ] 验证/重置邮件包含正确链接。
- [ ] webhook 非 2xx 抛错并保留账号。
- [ ] 生产无可用传输时启动失败。
- [ ] 日志不打印令牌与邮件正文中的敏感信息。

## 代码位置（计划）

- `apps/api/src/modules/auth/mail.ts`
- `packages/config/src/env.ts`

## 备注

重试队列后续。
