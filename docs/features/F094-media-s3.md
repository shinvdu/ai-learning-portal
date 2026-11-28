# F094 MinIO/S3 媒体

| 项 | 值 |
|---|---|
| 阶段 | M8 |
| 优先级 | P1 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 基础设施 |
| 依赖 | F090, F061 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

为未来课程视频上传提供对象存储适配，多实例共享媒体。

## 行为与范围

- 存储适配器 local/s3，环境变量选择。
- 管理端获取预签名上传/播放 URL；响应含 `driver` 与稳定站内 `path`（`/api/v1/media/<key>`），课程/章节应持久化 `path` 而不是绝对、会过期的 `publicUrl`。
- 管理端上传 UI 由 [F095](F095-admin-media-upload-ui.md) 提供：默认走 [F098](F098-chunked-resumable-upload.md) 的分片/断点续传；旧单请求端点保留兼容（local 原始直传或 S3 预签名 PUT，上限 50 MiB）。
- 媒体库维护由 [F097](F097-media-delete-orphan-cleanup.md) 提供：`GET /admin/media`（含引用）、`DELETE /admin/media/:key`（默认拒绝删除被引用对象）、`POST /admin/media/cleanup`（孤儿清理，支持 dry-run 与宽限期）。存储适配新增 `list`/`stat`/`remove`/`putFile`。
- 本地开发可继续用 public/assets 占位视频。
- MinIO 通过 compose profile 启动；浏览器直传需 CORS（compose 的 `MINIO_API_CORS_ALLOW_ORIGIN`）。
- 前端 CSP 已允许 `media-src 'self' blob:`，Nginx 上传体上限提到 64m。

## 验收标准

- [x] s3 模式下视频 URL 可播放且支持 Range。
- [x] 切换 local 不影响现有页面。
- [x] 预签名 URL 有有效期，稳定 `path` 不过期。
- [x] 密钥不进入前端。
- [x] 管理端可完成上传（local/S3）并写回站内路径（local 与 S3 浏览器直传均已实机复验，S3 保存 `/api/v1/media/<key>` 后 302→Range 206）。

## 代码位置

- `apps/api/src/modules/media/`（`routes.ts`、`local-storage.ts`、`s3-storage.ts`；F097 的 `library-service.ts`、F098 的 `upload-service.ts`）
- `apps/web/src/components/admin/MediaUploader.vue`（F095）、`MediaLibrary.vue`（F097）
- `apps/web/src/api/endpoints.ts`（`mediaApi`）
- `compose.yml`、`apps/api/src/middleware/security-headers.ts`、`apps/web/nginx/default.conf`

## 备注

本期不做转码与 HLS。媒体 API 与上传 UI 现已配套：API 负责存储与鉴权，UI 负责浏览器上传与 `path` 回填。
媒体对象不在 `pg_dump` 中：local 需备份整个 `MEDIA_DIR`（含 `.meta`；`.uploads` 为暂存，可随会话 TTL 清理），S3 需桶版本化/独立备份。删除与孤儿清理见 [F097](F097-media-delete-orphan-cleanup.md)。
