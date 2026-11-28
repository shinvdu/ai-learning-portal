# F012 安全原语包（TOTP/恢复码/密码/密钥盒）

| 项 | 值 |
|---|---|
| 阶段 | M1 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 领域层 |
| 依赖 | F001 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

集中实现认证所需的密码哈希、TOTP、恢复码与 MFA 密钥加密，供 API 与测试复用。

## 行为与范围

- Argon2id 哈希/校验；旧 scrypt$ 格式可验证并标记需升级。
- TOTP 使用 SHA-1、6 位、30 秒、±1 窗口与常量时间比较。
- 8 枚 XXXX-XXXX 恢复码，规范化后以 SHA-256 存储。
- AES-256-GCM 密钥盒（v1:iv:tag:ciphertext），解密失败显式报错。

## 验收标准

- [ ] RFC 6238 测试向量通过；错误码与空码被拒绝。
- [ ] 旧 scrypt 哈希可验证并触发重哈希。
- [ ] 恢复码单次使用，大小写与连字符兼容。
- [ ] 密钥盒 roundtrip 与篡改检测通过。

## 代码位置（计划）

- `packages/domain/src/totp.ts`
- `packages/domain/src/password.ts`
- `packages/domain/src/secret-box.ts`
- `packages/domain/test/totp.test.ts`

## 备注

MFA_ENC_KEY 生产必填；开发使用固定 dev key 并告警。
