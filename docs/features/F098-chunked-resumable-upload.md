# F098 分片与断点续传上传

| 项 | 值 |
|---|---|
| 阶段 | M8 |
| 优先级 | P1 |
| 状态 | 待发布（v2.2.0，以追踪表为准） |
| 完成日期 | 待验证 |
| 模块 | 基础设施 / Web 认证管理 |
| 依赖 | F020, F090, F094, F095, F097 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md) · [F094 媒体存储](F094-media-s3.md) · [F097 删除与孤儿清理](F097-media-delete-orphan-cleanup.md)

## 目标

把单请求上传升级为**分片 + 断点续传**，解除 50 MB 的单文件限制（默认提升到 2 GiB，可配置），并保证 local 与 S3 两种驱动下大文件上传可恢复、可取消、可清理。

## 数据模型与迁移

新增迁移 `packages/db/drizzle/0003_media_uploads.sql` 与 `schema.ts` 的 `mediaUploads`（下方为简化示意，完整约束/索引以迁移文件为准）：

```sql
CREATE TABLE "media_uploads" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" bigint NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "total_size" bigint NOT NULL,
  "chunk_size" integer NOT NULL,
  "total_chunks" integer NOT NULL,
  "storage_driver" text NOT NULL,
  "status" text DEFAULT 'uploading' NOT NULL,
  "key" text NOT NULL,
  "uploaded_chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL
);
```

- `status` ∈ `uploading` / `completed` / `aborted` / `expired`（CHECK 约束）。
- `user_id` 外键 → `users.id`，`ON DELETE CASCADE`；只有创建者可读写自己的会话。
- 索引 `(status, expires_at)` 与 `user_id`。
- 表只记录**元数据与进度**；分片字节落在 API 主机磁盘，不进数据库。

## 会话 API

基址 `/api/v1`，全部要求管理员登录；写操作需 CSRF。

### 创建会话

`POST /admin/media/uploads`，请求体 `{filename, contentType, totalSize}`：

- `totalSize` 必须是正整数；超过服务端 `MEDIA_MAX_BYTES`（默认 2 GiB）返回 `413`。
- 实际分片大小 `chunkSize = min(MEDIA_CHUNK_SIZE, MEDIA_MAX_BYTES)`（默认 8 MiB）。
- `totalChunks = max(1, ceil(totalSize / chunkSize))`；最后一片可小于 `chunkSize`。
- `expiresAt = now + MEDIA_UPLOAD_TTL_HOURS`（默认 24 小时）。
- 创建前会顺带清理过期会话（见下文“过期与清理”）。
- 响应 `201`：

```json
{
  "id": "…18 字节 base64url…",
  "key": "<hex>.mp4",
  "chunkSize": 8388608,
  "totalChunks": 3,
  "uploadedChunks": [],
  "expiresAt": "2026-11-29T…Z",
  "status": "uploading"
}
```

- 审计 `media.upload_started`。

### 查询会话（续传）

`GET /admin/media/uploads/:id` → `{id, key, filename, contentType, totalSize, chunkSize, totalChunks, uploadedChunks, status, expiresAt}`。

- 仅创建者可读；他人或不存在一律 `404`（不泄露会话是否存在）。
- 客户端用 `uploadedChunks` 跳过已完成分片；`completed` 的会话仍可查询并再次 `complete`（幂等）。

### 上传分片

`PUT /admin/media/uploads/:id/chunks/:index`，原始字节流（`application/octet-stream`）：

- `index` 为 `0 … totalChunks-1` 的整数；会话必须处于 `uploading` 且未过期，否则 `409`。
- 分片不得为空，且不得超过会话 `chunkSize`（服务端以 `MEDIA_CHUNK_SIZE` 限制请求体），超限 `413`。
- **幂等**：重复上传同一 `index` 会覆盖该分片；`uploadedChunks` 去重后按升序记录，并行 PUT 不会互相丢失进度。
- 落盘：`MEDIA_DIR/.uploads/<id>/<index>.part`，先写临时文件再原子 `rename`。
- 响应 `200 {index, received, totalChunks}`。

### 完成与组装

`POST /admin/media/uploads/:id/complete`：

1. 校验所有分片 `0 … totalChunks-1` 均存在且各出现一次。
2. 逐片校验大小（最后一片按剩余字节），再顺序拼接到 `.uploads/<id>/assembled.part`；总大小必须等于 `totalSize`，否则 `400` 并保留分片供重试。
3. 写入存储驱动：
   - **local**：原子复制到 `MEDIA_DIR/<key>` 并写 `.meta` 副车。
   - **S3**：在本地组装完成后由服务端 `PutObject`（流式 body + 显式 `ContentLength`）上传；**不是** S3 multipart，浏览器始终只面对本 API。
4. 删除组装临时文件与会话目录，会话置 `completed`。
5. 审计 `media.upload_completed`。
6. 响应 `200 {key, path, driver, size}`；`path` 为可持久化的站内地址 `/api/v1/media/<key>`（与 F094/F095 一致）。
- 已 `completed` 的会话再次调用直接返回相同结果（幂等），便于网络重试。
- 存储写入失败时保留已上传分片，修复后可重试 `complete`，无需重传。

### 中止

`DELETE /admin/media/uploads/:id`：

- 非 `completed` 会话：置 `aborted`，删除 `.uploads/<id>`，审计 `media.upload_aborted`，返回 `200 {ok:true, status:"aborted"}`。
- 已 `completed`：`409`（对象已落盘，应改用 F097 的删除接口）。

### 过期与清理

- 会话超过 `MEDIA_UPLOAD_TTL_HOURS`（默认 24h）即过期；以下时机触发回收（`purgeExpiredUploads`）：
  - 创建新会话时、查询上传会话（`GET .../:id`）时、执行 F097 清理时。
- 回收动作：过期会话置 `expired` 并删除其暂存目录；终态（`completed`/`aborted`/`expired`）行在超过 TTL 后删除；`.uploads` 下不属于活跃会话且早于 TTL 的残留目录也会删除（崩溃/删行遗留）。
- 进行中的会话（`uploading` 且在 TTL 内）与其分片永不被回收。

## 存储、磁盘与网络

- 分片暂存始终在 **API 主机**的 `MEDIA_DIR/.uploads/<sessionId>/`，即使 `STORAGE_DRIVER=s3`。
- `complete` 期间峰值磁盘约为文件的 **2 倍**（分片 + 组装文件；local 落盘为再复制一次）；`MEDIA_DIR` 需预留空间并位于持久卷。
- 多实例部署时，续传只能命中暂存分片的同一实例：需要粘性会话（按会话 id）或共享卷；S3 模式下最终对象可共享，但**暂存仍在本机**。
- Nginx `client_max_body_size 64m` 对 8 MiB 分片足够；JSON 请求体上限仍为 2 MB。前端并行 2 个分片 PUT。
- 旧单请求端点保留兼容：`POST /admin/media/upload` 上限固定为 `min(MEDIA_MAX_BYTES, 50 MiB)`（`LEGACY_MEDIA_MAX_BYTES`），提升分片总上限不会放大单请求上限。

## 前端上传 UI

`MediaUploader.vue` 默认走分片流程（`mediaUploadApi`）：

- 创建会话 → 跳过 `uploadedChunks` → 2 路并发 PUT 剩余分片（XHR 上传进度）→ `complete`。
- 断点续传：用 `localStorage`（键为 `文件名+大小+lastModified`）保存会话 id；刷新/崩溃后先 `GET` 会话继续。会话缺失/过期/不存在时透明新建。
- 进度条显示总百分比、分片计数与实时速度；可取消（`abort` 会话并删除暂存）；失败可“重试（断点续传）”，已完成分片跳过。
- 409/404 视为会话失效，重试会新建会话；403 刷新 CSRF 后重放一次；网络/429/5xx 分片自动重试一次（最多两次尝试）。
- 客户端大小上限 `MEDIA_MAX_BYTES`（`VITE_MEDIA_MAX_BYTES`，默认 2 GiB）仅作前置提示，服务端仍为权威。
- 只向表单回传稳定 `path`，不持久化 `publicUrl`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `MEDIA_MAX_BYTES` | `2147483648`（2 GiB） | 分片上传的总大小上限；同时决定旧单请求端点上限 `min(该值, 50 MiB)` |
| `MEDIA_CHUNK_SIZE` | `8388608`（8 MiB） | 分片大小；实际取 `min(它, MEDIA_MAX_BYTES)` |
| `MEDIA_UPLOAD_TTL_HOURS` | `24` | 会话与暂存分片有效期 |
| `MEDIA_ORPHAN_GRACE_HOURS` | `24` | F097 孤儿清理宽限期，与上传 TTL 相互独立 |
| `VITE_MEDIA_MAX_BYTES` | 空（回退 2 GiB） | 构建期前端提示，不改服务端限制 |

## 验收标准

- [ ] 3 片文件可创建会话、逐片上传、complete 后 `GET /media/:key` 播放且 Range 206。
- [ ] 中断后 `GET` 会话返回 `uploadedChunks`，仅补传缺失分片即可完成。
- [ ] 分片大小/序号/会话状态/过期校验返回 400/409/413。
- [ ] 会话超过 TTL 变为 `expired`，暂存目录被删除；进行中会话不被清理。
- [ ] abort 删除暂存分片；已完成会话 abort 返回 409。
- [ ] local 与 S3（MinIO）两种驱动均可完成组装；S3 由服务端 `PutObject`。
- [ ] 管理端上传显示分片进度、可取消、可断点续传。
- [ ] 旧单请求上传仍受 50 MiB 上限保护。

## 代码位置

- `packages/db/drizzle/0003_media_uploads.sql`、`packages/db/src/schema.ts`、`packages/db/drizzle/meta/_journal.json`
- `apps/api/src/modules/media/upload-service.ts`（分片、组装、过期回收）
- `apps/api/src/db/repositories/media.ts`（会话 CRUD、幂等进度）
- `apps/api/src/modules/media/routes.ts`（上传会话路由、旧端点 50 MiB 上限）
- `apps/api/src/modules/media/local-storage.ts` / `s3-storage.ts`（`putFile`）
- `apps/web/src/components/admin/MediaUploader.vue`
- `apps/web/src/api/endpoints.ts`（`mediaUploadApi`）、`apps/web/src/api/client.ts`（`MEDIA_MAX_BYTES`）
- `packages/contracts/src/openapi.ts`（Media 上传路径）

## 备注

- 本期不做 S3 multipart 直传、转码/HLS、秒传（内容寻址去重）。分片大小与总上限均可配置，但需前后端一致。
- 分片暂存目录必须可写且最好持久化；非持久卷下重启会丢失未完成分片（数据库会话仍可重试，但需重传）。
- 数据库迁移 `0003` 为新增表，对旧版本透明；升级需执行 `npm run db:migrate`。