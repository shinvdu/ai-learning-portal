# F002 架构总文档与功能追踪体系

| 项 | 值 |
|---|---|
| 阶段 | M0 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 基础 |
| 依赖 | F001 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

把目标架构、里程碑、验收基线固化为单一总文档，并建立 Excel 追踪表与一特性一文件的说明目录，保证后续实施可追踪、可验收。

## 行为与范围

- docs/ARCHITECTURE_V2.md 作为唯一总文档，包含架构/数据/API/里程碑/风险。
- docs/FEATURE_TRACKER.xlsx 逐项跟踪阶段、优先级、状态、依赖、验收与文档链接。
- docs/features/ 每个特性一个 Markdown，命名 Fxxx-slug.md。
- 关键选型记录在 docs/DECISIONS.md。

## 验收标准

- [ ] 49 个特性均有说明文件，Excel 行数与目录一致。
- [ ] 每行说明文档是可点击的相对链接。
- [ ] 状态/优先级/阶段有下拉约束。
- [ ] 文档索引互链，路径在仓库内可解析。

## 代码位置（计划）

- `docs/ARCHITECTURE_V2.md`
- `docs/FEATURE_TRACKER.xlsx`
- `docs/features/`
- `docs/DECISIONS.md`

## 备注

新增/拆分功能必须同步更新 Excel 与特性文件。
