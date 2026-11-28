# F022 课程 ID 序列与排序

| 项 | 值 |
|---|---|
| 阶段 | M2 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 数据层 |
| 依赖 | F020 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

保证课程 ID 单调、不重用，并按 sort_order 与数字 ID 稳定排序。

## 行为与范围

- course_seq 序列分配 C{n}，导入时 setval 到 max(现有, legacy seq)。
- id_num 生成列用于排序，避免字符串截取。
- 删除最新课程后新建不复用旧 ID。
- 新建课程默认追加 sort_order。

## 验收标准

- [ ] seed 后 ID 为 C1–C5，下一个为 C6。
- [ ] 删除 C6 后新建得到 C7。
- [ ] C2 排在 C10 之前。
- [ ] 排序与 v1 的 ORDER BY 结果一致。

## 代码位置（计划）

- `packages/db/src/schema.ts`
- `apps/api/src/modules/courses/course-id.ts`

## 备注

迁移器需处理空库与已有数据两种情况。
