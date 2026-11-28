# F070 Vue 应用壳、路由与旧链接重定向

| 项 | 值 |
|---|---|
| 阶段 | M6 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | Web 公共 |
| 依赖 | F001 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

建立 Vue 3 应用壳、history 路由、旧 hash 链接兼容与全局布局。

## 行为与范围

- vue-router history 模式，路由表与总文档 2.8 一致。
- 捕获 #/... 旧链接并 replace 到新路径，保留 query。
- 顶栏/页脚/跳过链接/模拟数据标识。
- 全局加载、错误、Toast、404。

## 验收标准

- [ ] 旧 #/dashboard、#/course/C3 等自动跳转。
- [ ] 刷新任意深链 Nginx fallback 正常。
- [ ] 导航 aria-current 正确。
- [ ] 移动端导航可滚动。

## 代码位置（计划）

- `apps/web/src/main.ts`
- `apps/web/src/App.vue`
- `apps/web/src/router/index.ts`
- `apps/web/src/components/layout/`

## 备注

生产 Nginx try_files 兜底。
