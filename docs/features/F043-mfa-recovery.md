# F043 TOTP MFA、恢复码与密钥加密

| 项 | 值 |
|---|---|
| 阶段 | M4 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 认证安全 |
| 依赖 | F041, F012, F049 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

提供 TOTP 启用/停用、恢复码登录与 MFA 密钥加密存储。

## 行为与范围

- setup 生成待确认 secret；enable 校验 TOTP 后返回 8 枚恢复码。
- 恢复码单次使用，登录时大小写与连字符兼容。
- mfa_secret 用 AES-256-GCM 加密，生产需 MFA_ENC_KEY。
- 停用 MFA 需密码；启用后撤销其他会话。

## 验收标准

- [ ] 启用→登录挑战→TOTP 或恢复码均可登录。
- [ ] 重复使用恢复码失败。
- [ ] 错误 TOTP 计入锁定计数。
- [ ] 数据库中看不到明文 secret。

## 代码位置（计划）

- `apps/api/src/modules/auth/mfa.ts`
- `packages/domain/src/totp.ts`
- `packages/domain/src/secret-box.ts`

## 备注

恢复码仅展示一次。
