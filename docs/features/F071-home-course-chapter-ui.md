# F071 首页/课程/章节页面

| 项 | 值 |
|---|---|
| 阶段 | M6 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | Web 公共 |
| 依赖 | F070, F031, F032 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

复刻课程广场、课程详情与章节学习页的展示与交互。

## 行为与范围

- 首页分类/搜索/排序，卡片展示人数与完成率。
- 课程页视频、章节列表、到达率、统计。
- 章节页讲义、视频、测验、prev/next、推断值标注。
- 所有数字来自 API。

## 验收标准

- [ ] 首页显示 5 门课且筛选正确。
- [ ] 课程 C3 显示 17 人/55.9%。
- [ ] 视频可播放拖动；章节 30 个均可访问。
- [ ] 测验提交后显示答案与解析。

## 代码位置（计划）

- `apps/web/src/views/HomeView.vue`
- `apps/web/src/views/CourseView.vue`
- `apps/web/src/views/ChapterView.vue`
- `apps/web/src/components/course/`

## 备注

不硬编码任何 KPI。
