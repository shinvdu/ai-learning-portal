# Release v2.2.0 — 媒体库与分片上传

- **版本**：2.2.0
- **标签**：`v2.2.0`
- **状态**：**已发布**（2026-11-28）
- **Release**：https://github.com/shinvdu/ai-learning-portal/releases/tag/v2.2.0
- **兼容基线**：`v2.1.0` 可回退（`0003` 仅新增表，旧版本不读取即忽略）；`v1.2.0` 离线教学版继续保留。
- **前置**：`v2.1.0` 已发布。

> 发布已执行。以下验证记录保留为发布记录；媒体对象不在 pg_dump 中，仍需按运维流程单独备份。

## 发布内容

- **媒体库删除与孤儿清理（F097）**
  - `GET /api/v1/admin/media?limit=&offset=`：对象列表 + 课程/章节 `video.src|poster` 引用扫描（`references`）。
  - `DELETE /api/v1/admin/media/:key`：默认拒绝删除被引用对象（`409 {error, references}`）；`force=1` 强制删除。
  - `POST /api/v1/admin/media/cleanup`：`{dryRun?, graceHours?}`，删除未被引用且超过 `MEDIA_ORPHAN_GRACE_HOURS`（默认 24h）的对象，并回收过期上传会话；被引用对象与进行中的 `.uploads` 分片永不删除。
  - 管理后台新增“媒体库”标签：列表、引用明细、删除/强制确认、清理预演与执行。
  - 审计：`media.deleted`、`media.cleanup`。
- **分片与断点续传上传（F098）**
  - 迁移 `0003_media_uploads.sql` 新增 `media_uploads` 会话表（状态/进度/过期，用户外键级联，索引与 CHECK）。
  - 端点：`POST /api/v1/admin/media/uploads`、`GET .../:id`、`PUT .../:id/chunks/:index`、`POST .../:id/complete`、`DELETE .../:id`。
  - 默认 8 MiB 分片（`MEDIA_CHUNK_SIZE`），总上限 2 GiB（`MEDIA_MAX_BYTES`），会话 24h 过期（`MEDIA_UPLOAD_TTL_HOURS`）。
  - 分片暂存 `MEDIA_DIR/.uploads/<id>/`；local 原子落盘，S3 由服务端组装后 `PutObject`。
  - 管理端上传器改为分片上传：进度、速度、取消、断点续传（`localStorage` 记录会话）。
  - 审计：`media.upload_started`、`media.upload_completed`、`media.upload_aborted`。

## 变更

- `MEDIA_MAX_BYTES` 默认 50 MB → **2 GiB**，仅作用于分片上传；旧单请求 `POST /admin/media/upload` 仍固定 `min(MEDIA_MAX_BYTES, 50 MiB)`。
- 新增环境变量：`MEDIA_CHUNK_SIZE`（8 MiB）、`MEDIA_UPLOAD_TTL_HOURS`（24）、`MEDIA_ORPHAN_GRACE_HOURS`（24）；`VITE_MEDIA_MAX_BYTES` 回退值改为 2 GiB。
- 存储适配新增 `list`/`stat`/`remove`/`putFile`；S3 使用 `ListObjectsV2`（分页）、`HeadObject`、`DeleteObject`、流式 `PutObject`。
- 默认上传不再依赖浏览器预签名直传，`MINIO_API_CORS_ALLOW_ORIGIN` 仅为旧 presign 流程保留；Nginx 64m 足够 8 MiB 分片。

## 验证记录

- [x] `npm ci && npm run typecheck && npm run lint && npm run build` 通过。
- [x] `npm test` 全绿，含媒体库删除/清理与分片续传集成测试（专用测试库 `ai_portal_media_test`，与 `ai_portal_test` 隔离）。
- [x] `npm run test:e2e` 全绿。
- [x] 迁移验收：在临时库应用 `0001`–`0003`，重复执行幂等；`ai_portal_test` 迁移后 `/readyz` 200；开发库仅执行附加迁移，未改既有数据。
- [x] 分片上传实测（local）：3 片文件上传 → `complete` → `GET /media/:key` 206；中断后 `GET` 会话续传只需补缺片。
- [x] 分片上传实测（S3/MinIO）：服务端组装并 `PutObject`，公网路径 302 → 206；S3 凭据需 `Get/Put/Delete/ListBucket`。
- [x] 会话过期/中止：超过 TTL 置 `expired` 并删除暂存；`DELETE` 中止清理分片；已完成会话 `complete` 幂等、`DELETE` 409。
- [x] 媒体库：被引用对象删除 409，`force=1` 成功；清理 dry-run 不删除，执行只删未引用且超过宽限期的对象。
- [x] 管理端媒体库与上传器：进度、取消、断点续传、强制删除二次确认、清理预演/执行均可用，控制台无错误。
- [x] 备份说明：`pg_dump`/`pg_restore` 流程沿用 v2.1.0；媒体对象（local `MEDIA_DIR` 或 S3 桶）需单独备份，已在 DEPLOYMENT 说明。
- [x] 文档命令逐条可执行；内部链接存在；无硬编码密钥/真实凭据。

## 升级

`v2.1.0 → v2.2.0` **需要数据库迁移**：

```bash
git pull
npm ci
npm run db:migrate      # 应用 0003_media_uploads.sql（0001/0002 已应用的会跳过）
npm run build
# 重启 API 与 Web（或重新部署 compose；compose 的 migrate 任务会自动执行）
```

- `0003_media_uploads.sql` 仅新增 `media_uploads` 表、索引与约束，不修改既有表；旧版本可忽略该表。
- 非 compose 部署若跳过迁移，`/readyz` 会因 journal 版本落后返回 503，上传会话端点会因缺表失败。
- 新增可选环境变量见上；默认值即推荐值。`MEDIA_MAX_BYTES` 默认提升到 2 GiB，如需维持 50 MB 行为可显式设回 `52428800`（仅影响分片总上限，旧单请求端点始终 ≤50 MiB）。
- `MEDIA_DIR` 需为 `complete` 预留约 2 倍文件大小空间；多实例部署断点续传需粘性会话或共享暂存卷。
- 媒体对象不在 `pg_dump` 中：local 备份 `MEDIA_DIR`（含 `.meta`，`.uploads` 可不备），S3 开启版本化/独立备份。

## 回滚

- 应用回滚：检出 `v2.1.0` tag 重新部署；`0003` 新表对 v2.1.0 透明（不查询即忽略），无需删表。
- 如需完全还原 schema，使用升级前 `pg_dump` 恢复；迁移不提供自动 down。
- 分片上传进行中回滚会丢失会话（前端可重新创建）；已完成的媒体对象不受影响。

## 已知限制

- 不做 S3 multipart 直传、秒传（内容寻址去重）、转码/HLS。
- 孤儿清理当前为按需/管理端触发，未内置定时任务；可用 cron/systemd timer 调用 cleanup API。
- 分片暂存始终在 API 主机；无共享卷的多实例需粘性会话。
- 孤儿清理只识别 `/api/v1/media/<key>` 形式引用；不内置定时任务（可由 cron 调 API）。
- 删除与清理不可恢复（无回收站/软删除）。
- 媒体对象独立备份；AWS S3 未做真实云账号验收，MinIO 为基线。
- Playwright 仍为冒烟矩阵，不是全量回归；审计 WORM、Metrics/Tracing、SSO/SCIM、多租户、WAL/PITR 仍不在范围内。

## 参考

- [CHANGELOG.md](../CHANGELOG.md)（`[Unreleased]`）
- [Deployment](DEPLOYMENT.md)
- [API](API.md)
- [Local development](DEVELOPMENT.md)
- [Production readiness](PRODUCTION_READINESS.md)
- [F097 媒体库删除与孤儿清理](features/F097-media-delete-orphan-cleanup.md)
- [F098 分片与断点续传上传](features/F098-chunked-resumable-upload.md)