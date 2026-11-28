# F096 章节独立视频

| 项 | 值 |
|---|---|
| 阶段 | M5 |
| 优先级 | P1 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 管理数据 |
| 依赖 | F061, F020, F094, F095 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

让每一章拥有与课程解耦的视频配置：可继承课程视频、单独上传/指定视频，或明确关闭；公开页按章节解析，而不是所有章节共用 `CHAPTER_VIDEO_DEFAULT`。

## 数据模型与迁移

新增迁移 `packages/db/drizzle/0002_chapter_video.sql`：

```sql
ALTER TABLE "chapters" ADD COLUMN "video_mode" "video_mode" DEFAULT 'inherit' NOT NULL;
ALTER TABLE "chapters" ADD COLUMN "video" jsonb;
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_video_mode_payload"
  CHECK ((("chapters"."video_mode" = 'custom') = ("chapters"."video" is not null)));
```

- `chapters.video_mode`：复用课程的 `video_mode` 枚举（`inherit` / `custom` / `none`），默认 `inherit`，因此升级后既有章节行为不变。
- `chapters.video`：`custom` 时的视频 payload（`src`、`poster`、`durationText`、`note` 等）；其余模式必须为 `NULL`，由 CHECK 约束保证。
- 升级到含 F096 的 v2.1.0 **必须执行 `npm run db:migrate`**（或生产 compose 的 `migrate` 任务）。这取代了 v2.1.0 早期草稿中“无需迁移”的说法。

## 管理 API

- `POST /admin/courses/:courseId/chapters` 接受可选 `video_mode` 与 `video`；未提供时默认 `inherit`；提供 `video` 而未给模式时按 `custom` 处理。
- `PATCH /admin/courses/:courseId/chapters/:idx` 支持部分更新视频状态；`video_mode=none/inherit` 会清空 `video`，`custom` 可沿用已有 payload。
- 与课程共用 `apps/api/src/lib/video.ts` 的校验与解析，`src`/`poster` 仅接受站内路径（含 `/api/v1/media/<key>`，但拒绝外站、`//` 与路径穿越）。
- `GET /admin/courses` 的 `chapterDetails` 返回原始 `video_mode` 与 `video`，供编辑器回显。

## 公开解析优先级

`GET /api/v1/chapters/:courseId/:idx` 返回 `chapter.video`（可为 `null`）：

1. `none` → `null`（章节页显示“本章暂无视频”，讲义与测验照常）。
2. `custom` → 该章节的 payload。
3. `inherit` → 内容包内的 `CHAPTER_VIDEOS['<courseId>-<idx>']` 静态覆盖（若存在，叠加在课程视频之上）；否则使用课程解析后的视频，即课程 `custom` → 课程视频内容/静态默认（`DEMO_VIDEO`），课程 `none` → `null`。

因此实际优先级为：**章节 custom > 内容包章节覆盖 > 课程 custom > 内容包课程视频/静态默认**；任一层的 `none` 都可关闭展示。

## 管理 UI

- `ChapterDialog` 嵌入 `VideoConfigFields`（`context="chapter"`）：继承课程视频 / 自定义本章视频 / 不显示视频；自定义可上传（`MediaUploader`，local 或 S3）或填写站内 URL。
- `ChapterManager` 在每章显示视频模式标签；自定义视频不显示为“统一示例”。
- 公开 `ChapterView` 无视频时使用空状态，不再渲染静态占位播放器。

## 验收标准

- [x] 既有章节升级后默认为 `inherit`，公开视频与升级前一致。
- [x] 章节 `custom` 覆盖课程视频；课程 `custom` 可被 `inherit` 章节继承。
- [x] 章节 `none` 隐藏视频，课程视频仍解析（互不影响）。
- [x] 外站 URL、协议相对 URL 与路径穿越被 400 拒绝。
- [x] 管理端 `chapterDetails` 可回显三态，保存后公开页立即变化。

## 代码位置

- `packages/db/drizzle/0002_chapter_video.sql`、`packages/db/src/schema.ts`
- `apps/api/src/lib/video.ts`
- `apps/api/src/modules/chapters/routes.ts`、`admin-routes.ts`
- `apps/api/src/db/repositories/catalog.ts`、`courses-admin.ts`
- `packages/contracts/src/chapters.ts`、`courses.ts`、`openapi.ts`
- `apps/web/src/components/admin/ChapterDialog.vue`、`ChapterManager.vue`、`VideoConfigFields.vue`
- `apps/web/src/views/ChapterView.vue`

## 备注

课程级三态仍由 F061 负责；F096 只增加章节级三态与其公开解析。章节视频与课程视频一样不做转码/HLS，媒体对象需随数据库一起备份。

v2.2.0 起，章节/课程视频的 `src`/`poster`（`/api/v1/media/<key>`）会被 [F097](F097-media-delete-orphan-cleanup.md) 的媒体库扫描为引用：删除被引用的对象默认返回 409（需 `force=1`），孤儿清理也会跳过被引用的对象。因此章节视频对象在替换后，旧 key 若不再被任何课程/章节引用才会进入孤儿清理候选。