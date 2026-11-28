# F020 PostgreSQL schema 与迁移框架

| 项 | 值 |
|---|---|
| 阶段 | M2 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 数据层 |
| 依赖 | F001 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

建立 v2 的 PostgreSQL 最终 schema、版本化迁移与并发安全迁移执行器。

## 行为与范围

- 全新 v2 使用 0001_initial.sql 合并基线，一次创建最终 schema（含认证加固与产品规范化）。
- 枚举、citext、timestamptz、date、jsonb、生成列、序列、索引、外键齐全。
- migrate.ts 使用 advisory lock，幂等，可重复执行。
- Drizzle journal 记录已应用版本，运维可查询 drizzle.__drizzle_migrations。

## 验收标准

- [ ] 空库迁移一次成功，二次执行为 no-op。
- [ ] 并发两个 migrate 进程不冲突。
- [ ] 外键与检查约束拒绝非法数据。
- [ ] 表/索引与总文档 2.5 一致。

## 代码位置（计划）

- `packages/db/src/schema.ts`
- `packages/db/src/relations.ts`
- `packages/db/src/client.ts`
- `packages/db/src/migrate.ts`
- `packages/db/drizzle/0001_baseline.sql`
- `packages/db/drizzle/0002_auth_hardening.sql`
- `packages/db/drizzle/0003_product_normalization.sql`

## 备注

旧 v1 的 0001/0002/0003 仅作逻辑参考；fresh-v2 不重放历史，迁移已验证通过。
