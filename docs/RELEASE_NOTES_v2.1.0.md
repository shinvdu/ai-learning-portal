# Release v2.1.0 — P1 增强

- **版本**：2.1.0
- **标签**：`v2.1.0`
- **状态**：**已发布**（2026-11-28）
- **Release**：https://github.com/shinvdu/ai-learning-portal/releases/tag/v2.1.0
- **兼容基线**：`v2.0.0` 可回退；`v1.2.0` 零依赖离线教学版继续保留。

## 发布内容

- **OpenAPI 3.1 + Scalar（F036）**：`GET /api/v1/openapi.json`（41 条路径、95 个 schema）；`GET /api/v1/docs` 在非生产或 `ENABLE_API_DOCS=1` 时开放。旧 `/api` 别名同样可访问。
- **CSV 数据快照与恢复（F064）**：CSV 导入与“恢复示例数据”前自动快照；管理后台“数据快照”标签；`GET /api/v1/admin/dataset/snapshots`、`POST /api/v1/admin/dataset/restore/:id`；恢复前再存一份 `pre-restore` 快照，因此恢复可回滚。
- **SMTP（F049 扩展）**：`MAIL_TRANSPORT=smtp` + `SMTP_URL`，通过 nodemailer 发送；缺少 URL 时启动失败。
- **local / S3·MinIO 媒体（F094）**：`STORAGE_DRIVER=local|s3`；本地 `MEDIA_DIR` + `MEDIA_MAX_BYTES`；S3/MinIO 使用 `S3_*`；新增 `/api/v1/media/:key`、`/api/v1/admin/media/presign`、`/api/v1/admin/media/upload`；开发 compose `media` profile 可启动 MinIO。
- **SQLite → PostgreSQL 导入器（F100）**：`npm run import:sqlite` / `scripts/import-sqlite.sh`，支持 `--dry-run`、`--wipe`、`--include-sessions`；只读打开 v1 SQLite，在单个 PostgreSQL 事务中导入。

## 验证记录

- `npm run typecheck`、`npm run lint`、`npm run build` 全部通过。
- **196 项测试**通过（含 OpenAPI、快照、SMTP、媒体、导入器）。
- **8 项 Playwright E2E**通过（Chromium + PostgreSQL/Redis services）。
- **MinIO 实机验收**（RELEASE.2024-12-18）：预签名 PUT/GET 200、Range 206、`/api/v1/media/:key` 302→206；课程视频 `video_mode=custom` + `src=/api/v1/media/<key>` 在公开课程接口正确返回。
- **SQLite 导入器**：v1 fixture dry-run 与临时库 apply 通过；golden 24/5/58/74.3/86.4/165.3，视频三态、审计、序列均核对。
- **备份/恢复**与生产 compose 冒烟沿用 v2.0.0 验证，无回归。

## 升级

`v2.0.0 → v2.1.0` **无需数据库迁移**：

```bash
git pull
npm ci
npm run build
# 重启 API 与 Web（或重新部署 compose）
```

新增可选环境变量：`SMTP_URL`、`STORAGE_DRIVER`、`MEDIA_DIR`、`MEDIA_MAX_BYTES`、`S3_*`。默认保持 `STORAGE_DRIVER=local`、`MAIL_TRANSPORT=console`（生产仍要求 webhook/smtp）。媒体对象不在 `pg_dump` 中；使用本地驱动时需备份 `MEDIA_DIR`，使用 S3/MinIO 时需备份 bucket。

## 回滚

- 应用回滚：检出 `v2.0.0` tag，重新部署/重启；P1 新增的媒体与快照数据不影响 v2.0.0 的正常运行。
- 数据库无需回滚（v2.1.0 未改变 schema）；如已导入 v1 数据，仍按 v2.0.0 的备份/恢复流程处理。

## 已知限制

- SMTP 无重试队列/退信处理。
- 媒体对象需独立备份；MinIO 已实机验证，AWS S3 未做真实云账号验收。
- Playwright 仍为冒烟矩阵，不是全量回归；审计保留/WORM、Metrics/Tracing、SSO/SCIM、多租户、强制管理员 MFA、WAL/PITR、CSP nonce 仍不在范围内。
- SQLite 导入器使用 v1 fixture 与临时库验收；有真实 v1 数据时应先 `--dry-run` 并核对 golden。

## 参考

- [CHANGELOG.md](../CHANGELOG.md)
- [Deployment](DEPLOYMENT.md)
- [API](API.md)
- [Local development](DEVELOPMENT.md)
- [Production readiness](PRODUCTION_READINESS.md)