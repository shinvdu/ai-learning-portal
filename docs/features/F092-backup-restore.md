# F092 备份与恢复

| 项 | 值 |
|---|---|
| 阶段 | M8 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 基础设施 |
| 依赖 | F020 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

提供 PostgreSQL 备份、保留与恢复演练脚本。

## 行为与范围

- 每日 pg_dump -Fc，保留 14 天。
- 备份文件校验（pg_restore --list）。
- 恢复脚本 --clean --if-exists，需显式确认。
- 记录备份日志与大小。

## 验收标准

- [ ] 备份可成功恢复到空库。
- [ ] 恢复后 golden 指标一致。
- [ ] 保留策略清理过期文件。
- [ ] 演练步骤写入部署文档。

## 代码位置（计划）

- `scripts/backup.sh`
- `scripts/restore.sh`
- `deploy/cron/`

## 备注

WAL/PITR 后续。
