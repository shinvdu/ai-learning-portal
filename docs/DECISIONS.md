# 架构决策记录（ADR）

本文记录 v2 重构中影响面较大的选型与取舍。每条包含背景、决策、替代方案与影响；实施中如改变决策，追加新条目而不是改写历史。

---

## ADR-001 产品级重写，保留 v1.2.0 离线版

- **背景**：v1 为零依赖 Node.js + SQLite + 原生前端，代码可维护性与横向扩展都到瓶颈。
- **决策**：在 `next` 分支做产品级重写；`main` 与 `v1.2.0` tag 永久保留为零依赖离线教学版；完成后合并并发布 `v2.0.0`。
- **替代方案**：原地增量改造（Strangler）。代码仅约 9k 行，增量迁移成本高于重写，且会长期背着两套中间件。
- **影响**：v2 需要 Node、PostgreSQL、Redis 与构建步骤；离线演示改用 `git checkout v1.2.0`。

## ADR-002 API 使用 Express 5 + TypeScript

- **背景**：现有 `node:http` 手写路由 1,229 行，无类型、无统一错误边界。
- **决策**：Express 5 + TypeScript（ESM）+ zod 校验；`createApp(deps)` 工厂便于 supertest 与多实例。
- **替代方案**：Fastify（性能更好、schema 原生）、NestJS（约束更强但更重）。团队熟悉度与迁移成本优先，选 Express。
- **影响**：Express 5 的 `path-to-regexp` 通配符语法与 SPA fallback 需要专项测试；`csurf` 已废弃，保留自研双提交中间件。

## ADR-003 数据库使用 PostgreSQL 16 + Drizzle ORM

- **背景**：SQLite 单写者，不能可靠支撑多实例；审计/会话/限流状态需要共享存储。
- **决策**：PostgreSQL 16；Drizzle ORM + drizzle-kit，迁移为纯 SQL；`pg` 连接池。
- **替代方案**：Prisma（运行时引擎重、SQL 不透明）、Kysely（纯查询器，迁移工具较弱）。Drizzle 在类型、SQL 可控性与迁移透明度之间最平衡。
- **影响**：需要迁移脚本与备份策略；`date` 类型必须按字符串返回，避免时区漂移。

## ADR-004 会话存 PostgreSQL，Redis 只做限流/缓存

- **背景**：会话需要持久、可撤销、跨实例一致；Redis 适合计数与缓存。
- **决策**：会话 token 的 SHA-256 存 PostgreSQL；Redis 承担固定窗口限流，后续可做看板缓存。
- **替代方案**：Redis 会话（快，但持久性与审计弱）、JWT（无状态但撤销困难）。
- **影响**：每请求一次会话查询，靠主键索引与连接池控制成本；Redis 故障不影响登录，只降级限流。

## ADR-005 自研 Redis 固定窗口限流

- **背景**：v1 是进程内 Map 固定窗口，成功登录会清空桶；直接换库容易改变可观察行为。
- **决策**：用 Lua `INCR` + `PEXPIRE NX` 实现固定窗口，键 `rl:<scope>:<ip|userId>`，成功时 `DEL`；Redis 故障回退进程内 Map 并标记 readiness 降级。
- **替代方案**：`rate-limiter-flexible`（滑动/增量窗口，语义不同）。
- **影响**：约 40 行 Lua + 封装；必须做双实例共享计数的集成测试。

## ADR-006 密码升级为 Argon2id，兼容旧 scrypt

- **背景**：v1 使用 Node 内置 scrypt；Argon2id 是当前更推荐的密码哈希。
- **决策**：新哈希用 `@node-rs/argon2`（预编译，无 node-gyp）；旧 `scrypt$...` 可验证，登录成功后透明重哈希。
- **替代方案**：继续 scrypt（零依赖但非最优）、bcrypt（72 字节限制）。
- **影响**：API 镜像用 Debian slim；旧库导入后用户无需重置密码。

## ADR-007 记录用 course_id 外键，不再存课程名

- **背景**：v1 的 `records.course_name` 是自由文本，改名要级联更新，且无外键完整性。
- **决策**：`records.course_id` 引用 `courses(id)`（`ON DELETE RESTRICT`）；API/CSV 仍以 `course_name` 展示，通过 join/视图解析；强制删除课程时事务内显式删记录。
- **替代方案**：保留冗余 `course_name` 并双写。会增加一致性负担。
- **影响**：CSV 导入需要课程名→ID 映射；改名不再影响历史记录；分析按 course_id 分组后用名称展示。

## ADR-008 视频状态显式化为 video_mode 枚举

- **背景**：v1 用 SQL NULL（继承种子）与 JSON 字符串 `"null"`（管理员删除）表达两种状态，容易误判。
- **决策**：`video_mode enum('inherit','custom','none')` + `video jsonb`，check 约束保证一致性；管理端三选一。
- **替代方案**：保留 sentinel（迁移简单但语义脆弱）。
- **影响**：导入器必须正确映射三种旧状态；公共页与测试覆盖三态。

## ADR-009 前端 Vue 3 + Vite + history 路由，不引 UI 库

- **背景**：v1 是 2,561 行单文件原生 SPA，组件复用与状态管理缺失；同时已有明确的奶油/深蓝/青色视觉。
- **决策**：Vue 3 + Vite + TypeScript；vue-router history 模式并重定向旧 hash 链接；Pinia 仅管 auth/toast；ECharts 按需引入；自建 CSS 设计系统，不引 Element Plus/Naive UI。
- **替代方案**：Nuxt（SSR 对内部系统无必要）、React（团队与现有资产不匹配）、UI 库（视觉冲突、包体大）。
- **影响**：表格/对话框等基础组件需自建；可访问性与视觉回归需 e2e/截图验收。

## ADR-010 API 规范路径 /api/v1，保留 /api 薄别名

- **背景**：v2 会改变部分实现，但外部脚本可能仍调用旧路径。
- **决策**：规范路径 `/api/v1`；旧 `/api` 挂同一 router，加 `Deprecation` 与 successor `Link` 头。
- **替代方案**：直接切 `/api/v1`（简单但破坏兼容）、永久双份实现（维护成本高）。
- **影响**：别名不复制处理器；响应形状与错误 envelope 保持 v1 兼容。

## ADR-011 使用 npm workspaces

- **背景**：环境无 pnpm；需要多包（api/web/domain/contracts/db/content/config）。
- **决策**：npm workspaces + 根 lockfile + TypeScript project references。
- **替代方案**：pnpm（更快、严格，但需额外安装）、单包多目录（依赖边界弱）。
- **影响**：CI 用 `npm ci`；workspace 依赖通过 `@portal/*` 解析。

## ADR-012 部署以 Docker Compose + Nginx 为主

- **背景**：需要多实例、可复现与 TLS/静态托管。
- **决策**：Compose 编排 postgres/redis/migrate/api/web；Nginx 负责 TLS/HSTS/静态/SPA/边缘限流；保留 systemd 方案作为非容器备选。
- **替代方案**：Kubernetes（当前规模过重）、纯 systemd（多实例与回滚较弱）。
- **影响**：API 镜像需兼容 Argon2 预编译；备份用 `pg_dump -Fc`；升级按 migrate → api 滚动。

## ADR-013 P1 功能显式延后

- **背景**：完整产品化范围较大，需要区分 v2.0.0 必须项与可后补项。
- **决策**：以下标记为 P1，可在 v2.0.0 后补：OpenAPI/Scalar、CSV 快照与撤销、SMTP、MinIO/S3 媒体、SQLite→PG 导入器、Playwright 全量矩阵。
- **影响**：追踪表中 P1 共 4 项（F036、F064、F094、F100）；不影响核心验收，但导入器在有真实数据时必须先完成。