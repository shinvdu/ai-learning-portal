# F097 媒体库删除与孤儿清理

| 项 | 值 |
|---|---|
| 阶段 | M8 |
| 优先级 | P1 |
| 状态 | 待发布（v2.2.0，以追踪表为准） |
| 完成日期 | 待验证 |
| 模块 | 基础设施 / Web 认证管理 |
| 依赖 | F020, F061, F090, F094, F095, F096, F098 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md) · [F094 媒体存储](F094-media-s3.md) · [F098 分片续传](F098-chunked-resumable-upload.md)

## 目标

补齐媒体对象的生命周期管理：管理员能看到媒体库里有哪些对象、分别被哪些课程/章节引用，能安全删除单个对象，并能定期清理**无人引用**的孤儿对象。删除与清理都必须避免破坏仍在使用的页面，也要避免误删进行中的上传。

## 行为与范围

### 媒体列表与引用

- `GET /api/v1/admin/media?limit=&offset=`（管理员）列出当前存储驱动下的对象，按 `lastModified` 倒序（同一时间按 `key` 升序），分页（`limit` 1–200，默认 50；`offset` ≥0，默认 0）。
- 每个对象返回稳定站内路径 `/api/v1/media/<key>`、大小、最后修改时间、推断的 `contentType`，以及 `references`：
  - 扫描 `courses.video` 与 `chapters.video` 的 `src` / `poster`，匹配 `/api/v1/media/<key>`。
  - `type` 为 `course` / `chapter`；`id` 为课程 id 或 `<course_id>-<idx>`；`field` 为 `src` / `poster`。
- 引用为**只读扫描结果**，用于展示与预判；删除时会重新服务端校验，不信任页面加载时的旧结果。
- 列表来自存储驱动自身的列举能力：local 读取 `MEDIA_DIR` 下的普通文件（跳过 `.meta`、`.uploads` 等点前缀目录），S3 使用分页 `ListObjectsV2`。

### 单个删除

- `DELETE /api/v1/admin/media/:key`（管理员）。
  - 对象被引用且未带 `force`：返回 `409 {error, references}`，不删除。`error` 提示使用 `force=1`。
  - `force=1`（也接受 `true`/`yes`/`on`）：即使被引用也删除，课程/章节对应视频或封面将 404。
  - 对象不存在或 `key` 不合法：`404`。
  - 成功：`200 {ok:true, key, references}`；`references` 回显删除前的引用，便于审计追溯。
- 删除同时清掉 local 的 `.meta/<key>.json` 副车；S3 发送 `DeleteObject`。
- 所有删除写入审计 `media.deleted`（`details.forced` 与 `details.references`）。

### 孤儿清理（dry-run / 宽限期）

- `POST /api/v1/admin/media/cleanup`（管理员，请求体可选 `{dryRun?, graceHours?}`）。
- 判定：
  - **被引用**的对象永不删除（计入 `skippedReferenced`）。
  - 最后修改时间在宽限期内的对象跳过（计入 `skippedYoung`），默认宽限 `MEDIA_ORPHAN_GRACE_HOURS`（24 小时），请求可用 `graceHours`（0–8760）覆盖。
  - 其余对象为孤儿候选。
- `dryRun:true` 只返回候选（`items`）与计数，不删除；`dryRun` 为 false 才真正删除。
- 清理前先处理过期上传会话（F098）：非 dry-run 会真正过期并删除暂存分片，dry-run 只统计数量。
- `.uploads` 目录不参与对象列举，因此**进行中的上传分片永远不会被清理**。
- 单个对象删除失败不中断整体清理，失败项进入 `errors`。
- 响应：

```json
{
  "deleted": 2,
  "skippedReferenced": 5,
  "skippedYoung": 1,
  "errors": [{ "key": "…", "error": "…" }],
  "purgedUploads": 1,
  "items": [{ "key": "…", "size": 1048576, "lastModified": "2026-11-27T…Z", "reason": "orphan" }]
}
```

  说明：`items` 仅列出孤儿对象候选（`reason` 为 `orphan`；契约保留 `expired-upload` 以便扩展）；过期上传会话以 `purgedUploads` 计数，不混入 `items`。
- 清理写入审计 `media.cleanup`（dryRun、graceHours、deleted、skippedReferenced、skippedYoung、purgedUploads、错误数）。

### 管理端媒体库标签页

- 管理后台新增“媒体库”标签（`MediaLibrary.vue`）：对象列表、分页、类型/大小/修改时间、引用明细、“只看未引用”筛选。
- 删除单对象需确认；被引用对象需**二次强制确认**，文案明确会破坏哪些页面。
- 孤儿清理面板：输入宽限期 → “预演”查看候选 → “执行清理”再次确认；结果展示删除/跳过/过期会话/错误。

### 备份与运维含义

- 媒体对象**不在 `pg_dump` 中**。local 驱动需备份整个 `MEDIA_DIR`（含 `.meta`）；S3 需桶版本化或独立备份。数据库恢复后若媒体未一并恢复，引用会指向缺失对象。
- 清理会删除“数据库不再引用”的对象；执行前先 dry-run。删除被引用对象（force）是破坏性操作，不会自动回滚。
- 清理依赖存储列举与删除权限：S3 需 `s3:ListBucket` 与 `s3:DeleteObject`（详见 [DEPLOYMENT.md](../DEPLOYMENT.md) §13）。

## API 形状

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/admin/media?limit=&offset=` | — | `{total, limit, offset, items:[{key, path, size, lastModified, contentType, references:[{type,id,field}]}]}` |
| DELETE | `/admin/media/:key?force=1` | — | `200 {ok,key,references}` / `409 {error,references}` / `404` |
| POST | `/admin/media/cleanup` | `{dryRun?, graceHours?}` | `{deleted, skippedReferenced, skippedYoung, errors[], purgedUploads, items[]}` |

`limit` 超范围或 `graceHours` 非 0–8760 整数时返回 `400`。

## 验收标准

- [ ] 列表返回对象与课程/章节引用，分页与倒序正确；local 与 S3 驱动均可列举。
- [ ] 删除被引用对象默认 `409` 且不删除；`force=1` 删除成功并回显引用。
- [ ] 清理只删除“未引用且超过宽限期”的对象；dry-run 不落盘删除。
- [ ] 进行中的上传分片（`.uploads`）不受清理影响。
- [ ] 删除与清理写入 `media.deleted` / `media.cleanup` 审计。
- [ ] 管理端媒体库可列表、删除（含强制确认）、dry-run 与执行清理。

## 代码位置

- `apps/api/src/modules/media/routes.ts`（媒体库路由）
- `apps/api/src/modules/media/library-service.ts`（孤儿判定与清理）
- `apps/api/src/db/repositories/media.ts`（`listMediaReferences`）
- `apps/api/src/modules/media/local-storage.ts` / `s3-storage.ts`（`list`/`stat`/`remove`）
- `apps/web/src/components/admin/MediaLibrary.vue`、`apps/web/src/views/admin/AdminHomeView.vue`
- `apps/web/src/api/endpoints.ts`（`mediaLibraryApi`）、`apps/web/src/api/types.ts`
- `packages/contracts/src/openapi.ts`（Media 路径）

## 备注

- 引用只识别 `/api/v1/media/<key>` 形式；外站或手填的其他 URL 不会被判定为引用，也不会被清理（因为不在媒体库对象中）。
- 本期不提供回收站/软删除；删除不可恢复。
- 清理是“按需触发”的管理操作，不内置定时任务；生产可用 cron 调用该端点或包装脚本。