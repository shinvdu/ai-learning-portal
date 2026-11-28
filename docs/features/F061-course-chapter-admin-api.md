# F061 课程与章节管理 API（含视频三态）

| 项 | 值 |
|---|---|
| 阶段 | M5 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 管理数据 |
| 依赖 | F030, F021 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

管理员可维护课程元数据、视频状态与章节，且不影响历史记录。

## 行为与范围

- 课程 CRUD、唯一名称、颜色/徽章校验、排序。
- **课程级** video_mode inherit/custom/none 三态；custom 校验站内相对 URL（含 `/api/v1/media/<key>`，拒绝外站/协议相对/穿越）。
- 章节新增追加最大 idx+1，删除保留空号；章节标题/正文 CRUD。
- 删除课程有记录时 409，force 时事务内删记录/章节/知识/课程。

> 章节级视频三态（`chapters.video_mode`/`video`）不在本功能内，见 [F096](F096-chapter-video.md)；管理端上传视频/封面的 UI 见 [F095](F095-admin-media-upload-ui.md)。本功能只负责课程级三态与章节基础 CRUD。

## 验收标准

- [ ] 新建课程得到 C6；改名后记录与指标不变。
- [ ] 视频三态切换在公共页正确呈现。
- [ ] 章节删除后编号空洞保留。
- [ ] 强制删除事务完整，无孤儿数据。

## 代码位置

- `apps/api/src/modules/courses/`
- `apps/api/src/modules/chapters/`
- `apps/api/src/db/repositories/courses-admin.ts`
- `apps/api/src/lib/video.ts`（课程/章节共用三态校验）

## 备注

课程名仍作为 CSV/API 的外部标识。章节视频列由 F096 的迁移 `0002_chapter_video.sql` 引入；升级时需 `npm run db:migrate`。
