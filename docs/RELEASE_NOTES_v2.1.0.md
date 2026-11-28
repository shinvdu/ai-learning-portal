# Release v2.1.0 — P1 增强

- **版本**：2.1.0
- **标签**：`v2.1.0`
- **状态**：**已发布**（2026-11-28）
- **Release**：https://github.com/shinvdu/ai-learning-portal/releases/tag/v2.1.0
- **兼容基线**：`v2.0.0` 可回退（新增列会被忽略）；`v1.2.0` 零依赖离线教学版继续保留。

## 发布内容

- **OpenAPI 3.1 + Scalar（F036）**：`GET /api/v1/openapi.json`（41 条路径、97 个 schema，含新增 `AdminChapterRow`）；`GET /api/v1/docs` 在非生产或 `ENABLE_API_DOCS=1` 时开放。旧 `/api` 别名同样可访问。
- **CSV 数据快照与恢复（F064）**：CSV 导入与“恢复示例数据”前自动快照；管理后台“数据快照”标签；`GET /api/v1/admin/dataset/snapshots`、`POST /api/v1/admin/dataset/restore/:id`；恢复前再存一份 `pre-restore` 快照，因此恢复可回滚。
- **SMTP（F049 扩展）**：`MAIL_TRANSPORT=smtp` + `SMTP_URL`，通过 nodemailer 发送；缺少 URL 时启动失败。
- **local / S3·MinIO 媒体（F094）**：`STORAGE_DRIVER=local|s3`；本地 `MEDIA_DIR` + `MEDIA_MAX_BYTES`；S3/MinIO 使用 `S3_*`；新增 `/api/v1/media/:key`、`/api/v1/admin/media/presign`、`/api/v1/admin/media/upload`；presign/upload 返回 `driver` 与稳定站内 `path`（`/api/v1/media/<key>`）。开发 compose `media` profile 可启动 MinIO。
- **管理端媒体上传 UI（F095）**：课程与章节表单内直接上传视频/封面；local 原始直传（CSRF、进度、413 提示）或 S3 预签名 PUT（需对象存储 CORS）；拖拽、大小/类型校验、blob 预览；只持久化稳定 `path`。CSP 增加 `media-src 'self' blob:`，Nginx 上传体上限 3m → 64m，开发 MinIO 增加 `MINIO_API_CORS_ALLOW_ORIGIN`。
- **章节独立视频（F096）**：迁移 `0002_chapter_video.sql` 为 `chapters` 增加 `video_mode`（默认 `inherit`）与 `video` jsonb + CHECK 约束；章节 API 接受三态与 payload；公开章节按 `custom` → 课程/静态 → `none` 隐藏 的优先级解析，无视频返回 `null`；管理端章节编辑器支持继承/自定义/关闭与上传。
- **SQLite → PostgreSQL 导入器（F100）**：`npm run import:sqlite` / `scripts/import-sqlite.sh`，支持 `--dry-run`、`--wipe`、`--include-sessions`；只读打开 v1 SQLite，在单个 PostgreSQL 事务中导入。

## 验证记录

- `npm run typecheck`、`npm run lint`、`npm run build`：**通过**（2026-11-28，含 F095/F096 变更）。
- `npm test`：**199 项通过**（16 个测试文件；含章节视频三态/路径校验、custom 空 payload 的 400 校验，与媒体 `driver`/`path` 断言）。
- **迁移验收**：在临时库先应用 `0001_initial.sql` 并写入既有课程/章节，再应用 `0002_chapter_video.sql`；既有章节自动变为 `video_mode=inherit`、`video=NULL`，CHECK 约束拒绝 `custom` 空 payload 与 `inherit` 携带 payload，重复执行幂等。`ai_portal_test` 迁移后 `/readyz` 返回 200；开发库 `ai_portal` 已应用同一 journal（2 条迁移），未改动既有数据。
- **上传 UI 本地驱动实测**（非开发端口，Playwright + Chrome，2026-11-28）：管理员在课程 C1 上传 mp4 与封面并保存，公开课程 `video.src`/`poster` 为 `/api/v1/media/<key>`；章节编辑器上传本章视频后公开章节返回该 `src`，`Range` 请求返回 206；章节设为 `none` 后公开页隐藏播放器并显示空状态。控制台无错误。
- **MinIO 实机验收**（RELEASE.2024-12-18，P1 基线）：预签名 PUT/GET 200、Range 206、`/api/v1/media/:key` 302→206；课程视频 `video_mode=custom` + `src=/api/v1/media/<key>` 在公开课程接口正确返回。F095/F096 的浏览器直传复验已通过（MinIO `MINIO_API_CORS_ALLOW_ORIGIN` 允许 Vite 源，浏览器 PUT 200 且带 `Access-Control-Allow-Origin`；保存后仍写站内 `path`，302 跳转后 Range 206）。
- Playwright E2E：**8 / 8 通过**（2026-11-28，本地系统 Chrome；CI 再跑一遍）。
- **SQLite 导入器**：v1 fixture dry-run 与临时库 apply 通过；golden 24/5/58/74.3/86.4/165.3，视频三态、审计、序列均核对。
- **备份/恢复**与生产 compose 冒烟沿用 v2.0.0 验证，无回归。

## 升级

`v2.0.0 → v2.1.0` **需要数据库迁移**（章节视频）：

```bash
git pull
npm ci
npm run db:migrate      # 应用 0002_chapter_video.sql
npm run build
# 重启 API 与 Web（或重新部署 compose；compose 的 migrate 任务会自动执行）
```

- `0002_chapter_video.sql` 只新增 `chapters.video_mode`（默认 `inherit`）与 `chapters.video`，升级后既有章节继续继承课程视频。
- 非 compose 部署若跳过迁移，`/readyz` 会因 journal 版本落后返回 503，章节查询会因缺列失败。
- 新增可选环境变量：`SMTP_URL`、`STORAGE_DRIVER`、`MEDIA_DIR`、`MEDIA_MAX_BYTES`、`VITE_MEDIA_MAX_BYTES`（前端构建期上限提示）、`S3_*`、`MINIO_API_CORS_ALLOW_ORIGIN`（仅开发 compose 的 MinIO）。默认保持 `STORAGE_DRIVER=local`、`MAIL_TRANSPORT=console`（生产仍要求 webhook/smtp）。
- 媒体对象不在 `pg_dump` 中；使用本地驱动时需备份 `MEDIA_DIR`，使用 S3/MinIO 时需备份 bucket。

## 回滚

- 应用回滚：检出 `v2.0.0` tag，重新部署/重启；`0002` 新增列对 v2.0.0 透明（ORM 不选择即忽略），无需删列。
- 数据库回滚：可保留 `0002` 的列；如需完全还原 schema，使用升级前的 `pg_dump` 恢复（迁移脚本不提供自动 down）。
- 若已导入 v1 数据，仍按 v2.0.0 的备份/恢复流程处理。

## 已知限制

- SMTP 无重试队列/退信处理。
- 媒体对象需独立备份；MinIO 已实机验证，AWS S3 未做真实云账号验收。S3 浏览器直传需要桶 CORS；无 CORS 时上传失败（可选择经 API 代理）。
- 媒体上传不分片/断点续传，受 `MEDIA_MAX_BYTES`（默认 50 MB）限制；不做转码/HLS。
- Playwright 仍为冒烟矩阵，不是全量回归；审计保留/WORM、Metrics/Tracing、SSO/SCIM、多租户、强制管理员 MFA、WAL/PITR、CSP nonce 仍不在范围内。
- SQLite 导入器使用 v1 fixture 与临时库验收；有真实 v1 数据时应先 `--dry-run` 并核对 golden。

## 参考

- [CHANGELOG.md](../CHANGELOG.md)
- [Deployment](DEPLOYMENT.md)
- [API](API.md)
- [Local development](DEVELOPMENT.md)
- [Production readiness](PRODUCTION_READINESS.md)
- [F095 管理端媒体上传 UI](features/F095-admin-media-upload-ui.md)
- [F096 章节独立视频](features/F096-chapter-video.md)