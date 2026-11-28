# F063 CSV 导入/导出/dry-run

| 项 | 值 |
|---|---|
| 阶段 | M5 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 管理数据 |
| 依赖 | F062, F011 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

保留整体替换导入语义，并增加 dry-run 与清晰的错误反馈。

## 行为与范围

- 导入接受 JSON {csv} 或 text/csv，2MB 限制。
- 事务内删除全部记录并插入有效行；错误最多 50 条带行号。
- dry-run 只解析校验，返回将插入/跳过的数量。
- 导出 UTF-8 BOM + CRLF，固定列序。

## 验收标准

- [ ] 导入 177 行后指标回 golden。
- [ ] 全非法输入不写入且返回错误。
- [ ] dry-run 不改变数据库。
- [ ] 导出文件 Excel 打开无乱码。

## 代码位置（计划）

- `apps/api/src/modules/records/csv.ts`
- `apps/api/src/modules/records/service.ts`

## 备注

快照与撤销见 F064。
