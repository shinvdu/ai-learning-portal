# F075 设计系统、响应式与无障碍

| 项 | 值 |
|---|---|
| 阶段 | M6 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | Web 公共 |
| 依赖 | F070 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

建立与 v1 视觉一致的 tokens、组件与可访问性基线。

## 行为与范围

- 颜色/圆角/阴影/字体 tokens 与 v1 对齐。
- 按钮/输入/对话框/表格/标签/Toast 等基础组件。
- 断点 1080/940/720/480，图表 720 紧凑。
- 跳过链接、焦点环、aria、键盘操作。

## 验收标准

- [ ] 关键页面截图与 v1 视觉接近。
- [ ] 键盘可完成登录、筛选、打开对话框。
- [ ] 颜色对比满足 WCAG AA。
- [ ] 390px 无横向溢出。

## 代码位置（计划）

- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/base.css`
- `apps/web/src/styles/components.css`
- `apps/web/src/components/ui/`

## 备注

不引入 Element Plus/Naive UI。
