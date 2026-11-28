# F100 SQLite→PG 导入器

| 项 | 值 |
|---|---|
| 阶段 | M9 |
| 优先级 | P1 |
| 状态 | 未开始（以追踪表为准） |
| 完成日期 | — |
| 模块 | 迁移发布 |
| 依赖 | F020, F021 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

把 v1 的 portal.db 一次性导入 v2 PostgreSQL，并保证口径一致。

## 行为与范围

- 只读打开 SQLite，dry-run 输出计数与差异。
- 迁移用户/课程/章节/知识/记录/审计/MFA 恢复码。
- 视频语义 NULL→inherit、字符串 null→none、对象→custom。
- 默认不导入会话/令牌；可选项导入未过期会话。

## 验收标准

- [ ] 导入后 24/5/58/177/30 与 golden 一致。
- [ ] 旧管理员 scrypt 密码可登录并升级。
- [ ] 重复导入不产生重复数据（wipe/upsert）。
- [ ] dry-run 不写库。

## 代码位置（计划）

- `apps/api/src/importers/sqlite-to-pg.ts`
- `scripts/import-sqlite.sh`

## 备注

当前示例站为模拟数据，可延后。
