# F095 管理端媒体上传 UI

| 项 | 值 |
|---|---|
| 阶段 | M7 |
| 优先级 | P1 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | Web 认证管理 |
| 依赖 | F082, F094, F061, F098 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

让管理员在课程/章节表单里直接上传视频与封面，不再手工填写 URL；上传在 local 与 S3/MinIO 两种驱动下都可用，并始终把**稳定站内路径**写入视频字段。

## 行为与范围

- 新增 `MediaUploader.vue`：文件选择 + 拖拽、客户端类型/大小校验、上传进度、`blob:` 预览、错误文案。
- 上传流程（v2.2.0 起默认走 [F098](F098-chunked-resumable-upload.md) 分片/断点续传）：
  1. `POST /api/v1/admin/media/uploads` `{filename, contentType, totalSize}` 创建上传会话，得到 `id`、`chunkSize`、`totalChunks` 与 `uploadedChunks`。
  2. `PUT /api/v1/admin/media/uploads/:id/chunks/:index` 逐片原始字节上传（2 路并发、XHR 进度）；`uploadedChunks` 供断点续传跳过已完成分片。
  3. `POST /api/v1/admin/media/uploads/:id/complete` 由服务端组装（S3 驱动也由服务端 `PutObject`），返回稳定 `path`。
- 旧单请求流程保留兼容，但 UI 不再使用：`POST /api/v1/admin/media/presign` → local `POST /api/v1/admin/media/upload` 原始直传，或 S3 浏览器预签名 `PUT`（`credentials: 'omit'`，需桶/MinIO CORS）。该端点上限固定 `min(MEDIA_MAX_BYTES, 50 MiB)`。
- 上传使用 XHR（`uploadBinary`）以获取上传进度；`fetch` 无上传进度，故不用于媒体。409/404 视为会话失效并允许“重试（断点续传）”；403 刷新 CSRF 后重试一次。
- 组件只向表单回传 `MediaUploaded.path`（`/api/v1/media/<key>`），**不持久化** `publicUrl`/`url`：后者可能是绝对地址，S3 下还会过期。
- `VideoConfigFields.vue` 复用同一上传器编辑视频与封面；`course` 与 `chapter` 两种上下文共用三态逻辑。上传中禁用保存按钮，避免把半完成状态提交。
- 选择“手动 URL”时保留原有输入框；`src`/`poster` 仍必须是站内路径（`/` 开头、非 `//`、无 `..`/反斜杠），由 API 二次校验。
- 大小上限：v2.2.0 前端镜像 `MEDIA_MAX_BYTES`（默认 2 GiB），可用 Vite 变量 `VITE_MEDIA_MAX_BYTES` 覆盖；服务端仍为权威。分片大小 `MEDIA_CHUNK_SIZE`（默认 8 MiB）。
- 相关基础设施：
  - CSP 增加 `media-src 'self' blob:`，并把 `img-src` 扩为 `'self' data: blob:`，支持上传前预览（不放开外部对象存储源）。
  - Nginx（容器内与边缘示例）`client_max_body_size` 从 3m 提到 64m，对旧的 50 MB 原始上传与 8 MiB 分片都足够；API 仍独立限制 2 MB JSON、分片大小与分片总量。
  - 开发 compose 的 MinIO 增加 `MINIO_API_CORS_ALLOW_ORIGIN`（默认 Vite 开发源），否则浏览器预检失败。

## 与 F094 的关系

F094 提供后端存储适配与媒体 API（presign/upload/read）；F098 提供分片/续传会话 API；F095 是**前端使用方**，不改变 API 语义，只消费会话/`driver`/`path` 并补充进度、取消、续传与预览能力。媒体 API 的鉴权、配额、存储布局仍以 F094/F098 为准。

## 验收标准

- [x] local 驱动下，管理员可在课程/章节表单上传视频与封面，页面出现进度与预览，保存后公开页可播放。
- [x] S3 驱动下，预签名 PUT 能从浏览器完成（MinIO 已实机复验浏览器直传 200，响应带 `Access-Control-Allow-Origin`；缺少 CORS 时 `ApiError` 路径给出检查对象存储 CORS 的可操作提示）。
- [x] 表单保存的是 `/api/v1/media/<key>`，不是绝对或会过期的 URL。
- [x] 超过 `MEDIA_MAX_BYTES` 或类型不符时，上传前即被拦截并提示。
- [x] 上传进行中不能提交表单；CSRF 过期可自动重试一次。

## 代码位置

- `apps/web/src/components/admin/MediaUploader.vue`
- `apps/web/src/components/admin/VideoConfigFields.vue`
- `apps/web/src/api/client.ts`（`uploadBinary`、`MEDIA_MAX_BYTES`）
- `apps/web/src/api/endpoints.ts`（`mediaApi`、`mediaUploadApi`）
- `apps/api/src/modules/media/routes.ts`（F094/F098 后端）
- `apps/web/src/components/admin/MediaLibrary.vue`（F097）
- `apps/api/src/middleware/security-headers.ts`、`apps/web/nginx/default.conf`、`deploy/nginx/portal.conf.example`、`compose.yml`

## 备注

v2.1.0 的上传器为单请求、受 50 MB 限制；v2.2.0 起默认分片/断点续传（F098），总上限提升到 `MEDIA_MAX_BYTES`（默认 2 GiB）。旧 presign/直传端点保留兼容但 UI 不再使用。S3 模式下分片仍暂存在 API 主机，`complete` 时由服务端组装并 `PutObject`，因此浏览器不再需要对象存储 CORS；若仍使用旧预签名直传，则需要桶 CORS。转码/HLS 仍不在范围内。