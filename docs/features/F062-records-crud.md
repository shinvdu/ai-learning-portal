# F062 学习记录 CRUD 与分页

| 项 | 值 |
|---|---|
| 阶段 | M5 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 管理数据 |
| 依赖 | F020, F030 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

管理员可分页查询与维护原始学习记录。

## 行为与范围

- 列表支持 course/student/q/limit/offset，排序固定。
- 新增/修改/删除均做整行校验并更新 dataset 元信息。
- 原始记录与导出仅管理员可访问。
- limit 1–200 默认 20，offset ≥ 0。

## 验收标准

- [ ] 分页总数/排序/过滤与 v1 一致。
- [ ] 非法日期/课程/分数被拒绝。
- [ ] 学习者访问 403，匿名 401。
- [ ] 每次修改递增 manual_edits。

## 代码位置（计划）

- `apps/api/src/modules/records/routes.ts`
- `apps/api/src/modules/records/service.ts`
- `apps/api/src/modules/records/validation.ts`

## 备注

记录通过 course_id 关联课程。记录本身不存储视频字段；课程/章节视频（F061/F096）与媒体上传（F095）不改变 CSV 列、记录校验或 golden 指标。
