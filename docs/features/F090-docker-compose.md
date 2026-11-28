# F090 Docker Compose 开发/生产

| 项 | 值 |
|---|---|
| 阶段 | M8 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 基础设施 |
| 依赖 | F020, F030, F070 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

提供可复现的本地与生产容器编排。

## 行为与范围

- postgres/redis/migrate/api/web 服务与健康检查。
- migrate 在 api 之前完成；api 非 root；数据卷持久化。
- 可选 minio profile 与备份 profile。
- 环境变量从 env 文件注入，不写死密钥。

## 验收标准

- [ ] docker compose up --build 后应用可访问。
- [ ] 迁移先于 API 完成。
- [ ] PG/Redis 故障时 readyz 失败。
- [ ] 数据卷重建后数据仍在。

## 代码位置（计划）

- `compose.yml`
- `deploy/compose.prod.yml`
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`

## 备注

API 镜像用 Debian slim 兼容 Argon2 预编译。
