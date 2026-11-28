# F011 CSV 解析/导出与记录校验

| 项 | 值 |
|---|---|
| 阶段 | M1 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 领域层 |
| 依赖 | F001, F013 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

统一 CSV 解析、导出与学习记录校验规则，保证导入导出与 v1 字节级行为一致。

## 行为与范围

- 解析 BOM、引号转义、CRLF/LF、逗号与空行；表头映射。
- 导出固定列序、UTF-8 BOM、CRLF、必要引号。
- 校验 student_id、课程存在、真实日历日期、分钟/章节范围、chapters_done ≤ total、quiz_score 0–100 或空。
- 未知课程与非法日期返回第 N 行错误。

## 验收标准

- [ ] 177 行样例解析零错误。
- [ ] 导出文件以 \uFEFF 开头并使用 CRLF。
- [ ] 2026-02-31 被拒绝；空成绩导入为 null。
- [ ] 错误最多 50 条且带行号。

## 代码位置（计划）

- `packages/domain/src/csv.ts`
- `packages/domain/src/validation.ts`
- `packages/domain/src/dates.ts`
- `packages/domain/test/csv.test.ts`

## 备注

课程名到 course_id 的映射在 API 层完成。
