# F091 Nginx TLS/HSTS/SPA/限流

| 项 | 值 |
|---|---|
| 阶段 | M8 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 基础设施 |
| 依赖 | F090, F070 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

提供生产反向代理与静态托管配置。

## 行为与范围

- HTTP→HTTPS、TLS 1.2/1.3、HSTS、安全响应头。
- 静态 immutable 缓存，index.html no-cache，SPA fallback。
- /api 代理、超时、body 限制、边缘限流。
- /healthz、/readyz 仅内网。

## 验收标准

- [ ] 深链刷新返回 index.html。
- [ ] API 与静态资源均正常。
- [ ] 健康检查外部不可访问。
- [ ] 安全头扫描通过。

## 代码位置（计划）

- `deploy/nginx/`
- `apps/web/nginx/default.conf`

## 备注

应用仍保留自身 2MB 限制与错误 envelope。
