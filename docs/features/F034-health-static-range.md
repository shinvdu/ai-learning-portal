# F034 健康检查、优雅退出、静态/SPA/Range

| 项 | 值 |
|---|---|
| 阶段 | M3 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | API 公共 |
| 依赖 | F030 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

提供生产可用的健康检查、退出流程与静态资源服务（含视频 Range）。

## 行为与范围

- /healthz 进程存活；/readyz 检查 PG/Redis/迁移状态。
- SIGTERM/SIGINT 停止接收、限时排空、关闭连接池。
- 静态资源支持单区间 Range 206/416；SPA fallback 仅无扩展名路径。
- 单进程 SERVE_WEB=1 可托管构建产物并设置 CSRF cookie。

## 验收标准

- [ ] Range bytes=0-99 返回 206 且长度正确。
- [ ] 有扩展名的不存在路径返回 404。
- [ ] PG 停止时 /readyz 返回 503。
- [ ] 退出后进程 0 退出且无悬挂连接。

## 代码位置（计划）

- `apps/api/src/modules/health/`
- `apps/api/src/lib/static.ts`
- `apps/api/src/index.ts`

## 备注

生产由 Nginx 托管静态资源；该能力用于单机与开发。
