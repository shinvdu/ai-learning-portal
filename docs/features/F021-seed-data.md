# F021 种子数据与幂等标记

| 项 | 值 |
|---|---|
| 阶段 | M2 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 数据层 |
| 依赖 | F020, F013 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

在新库中幂等导入课程、章节、知识与示例学习记录，并保持管理员删除不被重启复活的语义。

## 行为与范围

- catalog_seeded 与 chapters_seeded_<id> 标记控制一次性导入。
- 知识按课程存在性 INSERT ON CONFLICT DO NOTHING。
- 记录仅在表为空且允许演示数据时导入，课程名映射为 course_id。
- 生产默认跳过示例记录；重置需显式开关。

## 验收标准

- [ ] 新库 seed 后 5 课/30 章/5 知识/177 记录。
- [ ] 删除全部课程后重启不复活。
- [ ] 删除某课章节后重启不重建。
- [ ] 生产未设置开关时不导入记录。

## 代码位置（计划）

- `apps/api/src/seed/catalog.ts`
- `apps/api/src/seed/chapters.ts`
- `apps/api/src/seed/records.ts`
- `apps/api/src/seed/flags.ts`
- `apps/api/src/seed/seed.ts`
- `packages/db/fixtures/learning_records.csv`

## 备注

与 v1 的 meta 标记一一对应。
