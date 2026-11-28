# AI Learning Portal v2 目标架构与重构方案

> 状态：已实施；`v2.0.0` 与 `v2.1.0`（P1 增强）均已发布  
> 发布：`main` 当前 `v2.1.0`；`v1.2.0` tag 保留为零依赖离线教学版  
> 更新日期：2026-11-28  
> 本文是 v2 重构的**唯一总文档**；功能级细节见 `docs/features/`，进度与链接见 `docs/FEATURE_TRACKER.xlsx`。

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/ARCHITECTURE_V2.md` | 本文：目标架构、数据模型、接口、里程碑、验收与风险 |
| `docs/FEATURE_TRACKER.xlsx` | 功能追踪表：阶段、优先级、状态、依赖、验收标准、说明文件链接 |
| `docs/features/` | 一个特性一个 Markdown 文件（51 项） |
| `docs/DECISIONS.md` | 关键选型的 ADR 记录（随实施补充） |
| `docs/ARCHITECTURE.md` | v1.x 架构（冻结，仅作历史参考） |
| `docs/DEPLOYMENT.md` / `docs/DEMO_GUIDE.md` | v1.x 部署与演示（v2 发布后更新） |

---

## 1. 背景与结论

当前仓库是零依赖 Node.js 24（`node:http` + `node:sqlite`）+ 原生 ES Module 前端，约 9,344 行：`server.js` 1,229 行 / 26 个函数 / 24 个 API，`public/js/app.js` 2,561 行手写 hash 路由，`src/db.js` 934 行，`public/css/styles.css` 2,990 行。

**结论：同意重构，但要把两类“扩展”分开。**

| 扩展诉求 | Express + Vue 能解决吗 | 真正要做的事 |
|---|---|---|
| 功能增加、多人协作、长期维护 | ✅ 能 | 模块化、TypeScript、组件化、契约校验 |
| 并发、多实例、高可用 | ❌ 不能 | PostgreSQL + Redis + 对象存储 + 无状态 API |

当前真正的横向扩展瓶颈：

1. SQLite 单文件、单写者，会话/用户/课程/审计都在同一个库，多实例共享不可靠。
2. 限流是进程内 Map（`server.js:275` 的 `authHits`），多实例各算各的。
3. 视频/静态资源在本地磁盘，多节点需要共享存储。
4. 单体路由 + 手写前端 + 无类型，加功能和团队协作成本持续上升。

**已确认的决策**：做产品级重写；新架构放在同仓库 `next` 分支；`main` 与 `v1.2.0` tag 冻结为零依赖离线教学版；完成后合并 `next` → `main`，发布 `v2.0.0`。

---

## 2. 目标架构（产品级）

### 2.1 架构原则

- **API 无状态**：会话、限流、锁定计数全部外置，API 可水平扩到 N 个实例。
- **单一数据源**：业务数据只在 PostgreSQL；指标由 `packages/domain` 的纯函数计算，不在 SQL 里重写一套口径。
- **契约先行**：zod schema 同时产出运行时校验、TS 类型和 OpenAPI。
- **安全默认**：CSRF、会话哈希、MFA 密钥加密、审计只追加、生产配置 fail-fast。
- **可回退**：`v1.2.0` tag 永久保留，任何时点都能回到零依赖离线版。

### 2.2 技术栈

| 层 | 选择 | 理由 |
|---|---|---|
| 包管理 | npm workspaces（npm 11） | 环境无 pnpm；npm workspace 足够，CI 简单 |
| API | Express 5 + TypeScript（ESM，Node 24） | Express 5 原生支持 async 错误；团队熟悉 |
| 校验/契约 | zod 4 + zod-openapi | 一份 schema：校验、类型、OpenAPI |
| 数据访问 | Drizzle ORM + drizzle-kit + `pg` | SQL-first、迁移是纯 SQL、无运行时引擎 |
| 数据库 | PostgreSQL 16 | 多实例、事务、行锁、原生类型 |
| 缓存/限流 | Redis 7 | 共享固定窗口限流；后续可做看板缓存 |
| 日志 | pino + pino-http | 结构化日志、请求 ID、字段脱敏 |
| 安全头 | helmet | 保留现有 CSP 指令，生产加 HSTS |
| 密码 | Argon2id（`@node-rs/argon2`，预编译） | 新哈希用 Argon2id；旧 scrypt 登录时透明升级 |
| 前端 | Vue 3 + Vite + TypeScript | 组件化、类型、生态 |
| 路由/状态 | vue-router（history）+ Pinia | 真实 URL；仅 auth/toast 用全局状态 |
| 图表 | ECharts（按需引入） | 响应式、无障碍、坐标轴能力 |
| UI | 不引第三方组件库，自建 CSS 设计系统 | 保持现有奶油/深蓝/青色视觉，避免主题冲突 |
| 测试 | Vitest + supertest + Playwright | 单测、真实 HTTP 集成、端到端 |
| 部署 | Docker Compose + Nginx | 多实例、可复现、TLS/限流/静态托管 |

### 2.3 运行时拓扑

```text
Browser
  │ HTTPS
  ▼
Nginx（TLS/HSTS、静态资源、SPA fallback、边缘限流）
  ├── /            → apps/web 构建产物
  ├── /api/v1/*    → API 实例 × N（无状态）
  └── /healthz     → 仅内网
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
   PostgreSQL 16      Redis 7          Mail（webhook/SMTP）
   （唯一数据源）     （限流/缓存）      （验证/重置邮件）
        │
        └── 备份：pg_dump -Fc（每日，保留 14 天）

可选：MinIO/S3（未来课程视频上传；本期非必需）
```

### 2.4 仓库结构

```text
package.json                     # 私有 workspace 根；engines node>=24
tsconfig.base.json / tsconfig.json
eslint.config.js / prettier.config.mjs
vitest.workspace.ts / playwright.config.ts
compose.yml / .env.example / .nvmrc

apps/api/
  src/index.ts                   # 启动：配置校验 → 迁移检查 → seed → admin → listen → 优雅退出
  src/app.ts                     # createApp(deps)，供 supertest 复用
  src/config.ts                  # zod 环境变量 schema，生产 fail-fast
  src/lib/                       # logger/errors/rate-limit/csrf/origin/ip/pagination/openapi/cookies
  src/middleware/                # security-headers/body-parsers/session/require-admin/validate/error-handler
  src/modules/
    auth/                        # routes/controller/service/schemas + password/tokens/totp/recovery/lockout/mail
    users/ courses/ chapters/ knowledge/ analytics/ records/ dataset/ audit/ health/ media/
  src/db/                        # client.ts + repositories/*
  src/seed/                      # seed.ts + catalog/chapters/records/flags
  src/importers/sqlite-to-pg.ts  # 可选：旧库导入
  test/unit/ test/integration/

apps/web/
  src/main.ts App.vue
  src/router/index.ts            # history 路由 + 旧 hash 链接重定向
  src/api/client.ts endpoints.ts
  src/stores/auth.ts toast.ts
  src/composables/               # useApi/useCompact/useAsyncState/useConfirm/useCsrf
  src/components/                # layout/ui/charts/course/knowledge/dashboard/admin
  src/views/                     # Home/Course/Chapter/Knowledge/Dashboard/Insights/auth/account/admin
  src/styles/                    # tokens/base/components/utilities
  public/assets/                 # 8 秒占位视频 + 封面

packages/domain/                 # @portal/domain：analytics/csv/totp/password/secret-box/dates/types
packages/contracts/              # @portal/contracts：zod 请求/响应 schema + audit-actions 常量
packages/db/                     # @portal/db：Drizzle schema、migrations、fixtures、client
packages/content/                # @portal/content：5 门课、知识库、视频配置、讲义 txt
packages/config/                 # @portal/config：环境常量

deploy/                          # compose.prod.yml、nginx、systemd、env.example
docs/                            # ARCHITECTURE_V2 / FEATURE_TRACKER / features / DECISIONS / API / DEPLOYMENT
```

### 2.5 PostgreSQL 数据模型

表：`users`、`sessions`、`auth_tokens`、`mfa_recovery_codes`、`audit_log`、`courses`、`chapters`、`knowledge`、`records`、`app_meta`、`dataset_imports`、`record_snapshots`。

关键建模决策：

1. **`records.course_id` 外键**引用 `courses(id)`（`ON DELETE RESTRICT`），不再用自由文本 `course_name`。课程改名不再级联改记录；API/CSV 仍以 `course_name` 展示，通过 join/视图解析。强制删除课程时在事务里显式删记录再删课程。
2. **视频状态显式化**：`video_mode enum ('inherit','custom','none')` + `video jsonb`。替代现有“SQL NULL = 继承种子 / JSON 字符串 `"null"` = 管理员删除”的双重语义；check 约束保证 `custom` 必须有值、`none` 必须为空。
3. **课程 ID 保持 `C{n}`**，用 PG 序列 `course_seq` 单调分配；增加 `id_num` 生成列，排序用 `sort_order, id_num, id`，不再做字符串截取。
4. **邮箱大小写不敏感**：`citext` + UNIQUE；应用层仍 trim/lower。若目标库不允许 citext，回退 `UNIQUE (lower(email))`。
5. **类型规范化**：时间统一 `timestamptz`；`learning_date` 用 `date`，并在驱动层强制按字符串返回（`pg.types.setTypeParser(1082)`），避免时区漂移；`quiz_score` 用 `double precision`；布尔用原生 boolean。
6. **审计只追加**：应用不提供修改/删除接口；生产可用独立数据库账号只授 INSERT/SELECT（可选）。保留期/归档列为后续项。
7. **CSV 导入仍为“整体替换”**（一个事务：删全表 → 插入有效行），保留现有响应结构。新增非破坏能力：导入前 `record_snapshots` 快照 + 管理端恢复（P1）；导入 dry-run（核心）。
8. **`meta` → `app_meta`** 保持 key/value 字符串，迁移成本最低；新的结构化数据用显式列/jsonb。

迁移文件（fresh-v2）：

- `packages/db/drizzle/0001_initial.sql`：合并基线，一次创建最终 schema（含认证加固、产品规范化、枚举、citext、video_mode、records.course_id、id_num + course_seq、快照表与索引）。全新部署不重放 v1 的 0001/0002/0003；旧版迁移仅作逻辑参考。
- `packages/db/src/migrate.ts`：`pg_advisory_lock('portal_migrations')` 串行化迁移；Drizzle journal 记录已应用版本；新库与重复执行均幂等。

### 2.6 API 契约

- 规范路径 `/api/v1`；旧 `/api` 用同一 router 挂载，加 `Deprecation: true` 响应头（薄别名，不复制处理器）。
- 分组：
  - `auth`：`me`、`csrf`、`register`、`login`、`mfa`、`verify-email`、`resend-verification`、`forgot-password`、`reset-password`、`change-password`、`logout`、`mfa/setup|enable|disable`
  - 公共：`meta`、`courses`、`courses/:idOrName`、`chapters/:courseId/:idx`、`knowledge/:id`
  - 分析：`dashboard?course=`、`insights`
  - 管理：`records`（CRUD/分页/import/export）、`admin/users`、`admin/courses`（含章节、强制删除）、`admin/audit`、`admin/reset`、`admin/dataset/snapshots|restore`
  - 健康：`/healthz`、`/readyz`（不版本化）
- **响应形状保持兼容**：`{user}`、`{courses,categories,overview}`、`{ok,course}`、`{total,limit,offset,rows}` 等；错误仍是 `{error}` / `{error,errors[]}`；未知 API 仍是 404 `{error:'接口不存在'}`；邮件失败仍是 `502 {code:'MAIL_FAILED'}`；未验证登录仍是 `403 {code:'EMAIL_UNVERIFIED'}`。
- **中间件顺序**：request-id → pino-http → trust proxy → helmet/Cache-Control → 健康检查 → body parser（JSON/CSV，2MB）→ Origin 同源检查 → CSRF 双提交（Origin 缺失时按现有行为放行）→ cookie 解析 → 会话解析 → 路由级限流 → 角色闸门 → 控制器 → API 404 → 统一错误处理。
- **CSRF 发放入口**：生产 HTML 由 Nginx 提供，无法设置随机 Cookie，因此新增 `GET /api/v1/auth/csrf` 发放/刷新 `aip_csrf`；SPA 启动时若 Cookie 缺失则调用一次。单进程 `SERVE_WEB=1` 模式仍在返回 `index.html` 时设置，保持旧行为。
- **分页**：offset 分页，默认/上限与排序完全沿用；审计按 `id DESC`；记录按 `learning_date DESC, student_id, id`。
- **OpenAPI（P1）**：zod 生成 `/api/v1/openapi.json`，Scalar UI 在非生产或 `ENABLE_API_DOCS=1` 时开放。

### 2.7 认证与安全

- **密码**：Argon2id（OWASP 参数）新哈希；旧 `scrypt$...` 可验证，登录成功后透明重哈希。
- **会话**：256-bit 随机 token，Cookie `aip_session`（HttpOnly/SameSite=Lax/7 天/Secure 视 TLS）；库中只存 SHA-256。沿用绝对 7 天 TTL。
- **一次性令牌**：verify 24h / reset 1h / MFA challenge 5min；**在兑换时强制校验过期**（修复现有“只存不查”的缺陷，属有意行为变更，写入 CHANGELOG 与文档并加测试）。
- **MFA**：TOTP（SHA-1/6 位/30 秒/±1 窗口）+ 8 枚 `XXXX-XXXX` 恢复码；`mfa_secret` 用 AES-256-GCM 加密存储（`MFA_ENC_KEY`，生产必填）；启用后撤销其他会话。
- **锁定**：密码/MFA 共享失败计数；连续 5 次锁 15 分钟；锁定瞬间清零计数；成功即清零。登录失败更新用行锁避免丢更新。
- **最后管理员保护**：事务 + advisory lock；禁止自降级/自停用；停用撤销该用户所有会话。
- **限流**：Redis 固定窗口（Lua `INCR` + `PEXPIRE NX`），键形如 `rl:<scope>:<ip|userId>`；公共认证 20/10min，账户操作 10/10min；成功清除对应桶。Redis 故障时回退进程内 Map 并在 `/readyz` 标记降级。
- **审计**：事件名保持稳定（`auth.login`、`admin.user_updated`、`data.csv_imported` 等），写入失败只告警不影响主流程；详情不含密码/令牌。
- **邮件**：适配器 `webhook`（默认，契约不变：`POST {from,to,subject,text,html}` + Bearer）/ `smtp`（P1）/ `console`（仅开发）。生产要求至少一种可用传输。
- **生产 fail-fast**：`DATABASE_URL`、`REDIS_URL`、`PUBLIC_BASE_URL`、`MFA_ENC_KEY`、邮件传输、首次引导的 `ADMIN_PASSWORD`；不打印生成密码；演示数据默认不导入；`ALLOW_DEMO_RESET` 控制恢复示例数据。

### 2.8 前端

路由改为 history 模式，并保留旧 hash 链接重定向：

| 新路径 | 旧 hash | 页面 |
|---|---|---|
| `/` | `#/home` | 课程广场 |
| `/courses/:id` | `#/course/:id` | 课程详情 |
| `/courses/:courseId/chapters/:idx` | `#/chapter/:courseId/:idx` | 章节 |
| `/knowledge/:id?` | `#/knowledge/:id?` | 知识中心 |
| `/dashboard`、`/insights` | 同名 | 看板 / 洞察 |
| `/login`、`/register`、`/forgot`、`/reset`、`/verify` | 同名 | 认证 |
| `/account` | `#/account` | 账户与 MFA |
| `/admin`、`/admin/courses/:id` | `#/admin`、`#/admin/course/:id` | 管理后台 |

- `api/client.ts`：`/api/v1`、`credentials: 'same-origin'`；变更请求自动带 `X-CSRF-Token`，缺失时先取 `/auth/csrf`；`401` 清 auth store 并把受保护页跳登录；错误统一 `ApiError`。
- Pinia 只存 `auth` 与 `toast`；业务数据用视图内 composable，避免全局陈旧缓存。
- 图表用 ECharts 按需引入，保留 6 张图 + 5 个 KPI 卡；`useCompact()`（≤720px）切紧凑轴标签；提供无障碍摘要与空状态。
- 视觉：沿用现有 tokens（深蓝 `#000048`、青 `#06c7cc`、蓝 `#2f78c4`、奶油 `#fffbf5` 等）、卡片圆角/阴影/渐变 hero；不引入 UI 库。
- 可访问性：跳过链接、可见焦点、`<dialog>` 焦点管理、表单 label/`aria-describedby`、图表文本替代、加载/错误/Toast 模式与现版一致。
- 页面数字全部来自 API，源码中不出现 24/74.3/86.4 等硬编码。

### 2.9 运维与交付

- `compose.yml`：`postgres` + `redis` + `migrate`（一次性）+ `api`（非 root，8787）+ `web`（Nginx）+ 可选 `minio`（profile）。生产用 `deploy/compose.prod.yml`。
- 环境模板：`DATABASE_URL`、`MIGRATION_DATABASE_URL`、`REDIS_URL`、`PUBLIC_BASE_URL`、`ADMIN_*`、`MFA_ENC_KEY`、`MAIL_*`、`SEED_DEMO_RECORDS`、`ALLOW_DEMO_RESET`、`LOG_LEVEL`、`ENABLE_API_DOCS`。
- 健康：`/healthz` 仅进程存活；`/readyz` 检查 PG/Redis/迁移版本，失败 503。
- 退出：SIGTERM/SIGINT → 停止接收 → 10s 内排空 → 关闭 pool/redis → 退出 0。
- 日志：pino JSON、请求 ID（响应头 `X-Request-Id`）、慢请求告警、敏感字段脱敏。
- 迁移：部署先跑 `migrate` 一次性任务；advisory lock 防并发。
- 备份：每日 `pg_dump -Fc`，保留 14 天；恢复脚本 + 季度演练。WAL/PITR 后续。
- Nginx：TLS 1.2/1.3、HSTS、静态 immutable 缓存、`index.html` no-cache、`try_files` SPA fallback、边缘限流、健康检查仅内网、安全响应头。
- CI：`quality`（typecheck/lint/build）、`test`（Postgres/Redis service + 迁移 + seed + Vitest + golden）、`e2e`（Playwright）、`smoke`（curl：CSRF 403、匿名 401/403、管理员/学习者边界、Range 206、未知 API 404）。

### 2.10 与 v1.2.0 的有意差异

1. 一次性令牌兑换时校验过期（安全修复）。
2. 新密码哈希 Argon2id，旧 scrypt 登录时升级。
3. MFA secret 加密存储。
4. 记录用 `course_id` 外键，课程改名不再级联改记录。
5. 视频状态显式枚举，消除 NULL/`"null"` 歧义。
6. 限流迁移到 Redis（多实例一致）；Redis 故障降级。
7. 前端 hash 路由 → history 路由（旧链接自动重定向）。
8. 审计只追加（应用层；可选数据库权限）。

除此之外，API 形状、KPI 口径、认证流程、错误文案、CSV 行为、管理员保护等全部保持兼容。

---

## 3. 口径与验收基线

任何重构都必须逐项通过以下 golden 值（源自 `scripts/verify.js`）：

| 指标 | 值 |
|---|---|
| 学生数 | 24 |
| 课程数 | 5 |
| 选课数 | 58 |
| 记录数 | 177 |
| 平均完成率 | 74.3% |
| 平均测验成绩 | 86.4（53 条有成绩 / 5 条无成绩） |
| 累计学习时长 | 9,916 分钟 / 165.3 小时 |

分课程（学习人数 / 记录数 / 完成率 / 平均分）：

- 生成式 AI 基础：11 / 32 / 81.8 / 87.0
- 提示词工程入门：16 / 47 / 81.3 / 88.3
- Python 数据分析：17 / 53 / 55.9 / 81.1
- Web 前端开发实战：6 / 23 / 76.2 / 86.2
- AI 安全与负责任使用：8 / 22 / 87.5 / 90.3

附加验收：30 个章节、第 1 章到达率 100%、到达率单调不增、`81.25 → 81.3` 半分进位、空成绩不计 0、Python 筛选 17 人 / 55.9%、视频 Range 206、CSV BOM+CRLF、未知 API 404 文案、2MB 413、CSRF/角色边界、MFA 全流程、最后管理员保护、审计事件名。

---

## 4. 分阶段实施

工作量按 1 名全栈开发估算；前后端在 M3 后可并行，两人约 4.5–5.5 周。逐项功能与状态以 `docs/FEATURE_TRACKER.xlsx` 为准。

| 里程碑 | 交付物 | 验收标准 | 人日 | 依赖 |
|---|---|---|---|---|
| **M0 引导** | 从 `main` 建 `next`；workspace、TS project refs、ESLint/Prettier、Vitest/Playwright 骨架、`.env.example`、本总文档、功能追踪表与特性文档、CI 骨架 | `npm ci` + build + typecheck + lint 通过；`main` 仍为 v1.2.0 | 1 | — |
| **M1 领域包** | `packages/domain/contracts/content/config`；迁移讲义/CSV；移植 analytics/csv/totp/password/dates + 单测 | 纯函数 golden 全通过（24/5/58/74.3/86.4/165.3） | 2 | M0 |
| **M2 数据库** | Drizzle 最终 schema、`0001_initial.sql` 合并基线、advisory lock 迁移、seed（课程/章节/记录/flag/序列） | 新库迁移+seed 得到 5 课/30 章/177 记录；golden 精确；删课重启不复活；`course_seq` 不重用 | 4 | M1 |
| **M3 公共 API** | `createApp`、配置校验、中间件顺序、错误封装、公共目录/章节/知识/看板/洞察、健康、静态/SPA、旧 `/api` 别名 | 所有公共路由 curl 对齐；看板数值精确；404/413/Range/`readyz` 通过 | 4 | M2 |
| **M4 认证安全** | 认证模块、Argon2id + scrypt 升级、PG 会话、Redis 限流、CSRF/Origin、MFA/恢复码、锁定、最后管理员、审计、引导、邮件适配 | 认证集成测试全过；令牌过期测试；跨实例限流；审计事件名精确 | 6 | M3 |
| **M5 管理/数据** | 用户/课程/章节管理、视频三态、记录 CRUD/分页、CSV 导入导出/dry-run、恢复示例数据、审计查询 | 管理员集成测试；改名记录不变；强制删除事务；CSV 形状/上限/BOM | 4 | M4 |
| **M6 Web 公共页** | Vue 壳、设计 tokens、路由/旧链接重定向、API/CSRF 客户端、首页/课程/章节/知识/看板/洞察、图表封装 | 页面显示 golden 数字；筛选/测验/视频正常；390px 紧凑图表；无硬编码指标 | 6 | M3（可与 M4/M5 并行） |
| **M7 Web 认证/管理** | 登录/注册/忘记/重置/验证/账户、MFA UI、管理用户/课程/章节/审计、记录演示面板、确认对话框、可访问性 | Playwright 全流程通过；学习者边界；破坏性操作确认；旧 hash 深链可用 | 6 | M4/M5/M6 |
| **M8 基础设施** | API/Web Dockerfile、Nginx、Compose、migrate job、健康检查、优雅退出、备份/恢复、env 文档 | `docker compose up --build` 可用；迁移先于 API；PG/Redis 故障 readiness 失败；备份恢复演练成功 | 4 | M5/M7 |
| **M9 文档/切换** | README/README.en/ARCHITECTURE/API/DEPLOYMENT/DEMO_GUIDE/CHANGELOG；合并 `next`→`main`，tag `v2.0.0` | 验收清单通过；旧 v1.2.0 离线说明仍有效；release 发布 | 2–4 | M8 |

**核心范围约 39–41 人日（单人约 8 周；两人并行约 5 周）。** 以下为 P1 可选增量，可在 v2.0.0 后补：

- SQLite → PG 导入器（若现有部署有真实数据；当前示例站为演示数据，可延后）：+2 人日
- CSV 快照/撤销、OpenAPI+Scalar、SMTP、MinIO/S3 媒体：合计 +5–6 人日
- Playwright 全量矩阵与覆盖率门禁：+2 人日

**切换顺序**：`next` 开发 → 预发部署 + UAT（golden、认证、管理、CSV、移动端）→ 合并 `main` → tag `v2.0.0` → 发布镜像/Release。回退方案：重新部署 `v1.2.0`（SQLite 文件未动）。

---

## 5. 可直接复用的现有资产

| 现有文件 | 用途 |
|---|---|
| `src/analytics.js` | 1:1 移植到 `packages/domain/src/analytics.ts`，公式/文案/舍入不改 |
| `src/csv.js` | 移植解析/导出（BOM+CRLF、引号转义） |
| `src/totp.js` | 移植 TOTP/恢复码（加 RFC 测试向量） |
| `src/auth.js` | 会话/令牌/锁定/引导逻辑作为移植蓝本；修复过期校验 |
| `src/db.js` | 校验规则、course_seq、video 语义、CSV 事务、最后管理员、审计行为蓝本 |
| `src/content.js` + `data/lectures/` + `data/learning_records.csv` | 原样迁入 `packages/content` / `packages/db/fixtures` |
| `server.js` | 路由/中间件/CSRF/限流/静态/Range/生产检查的兼容基线 |
| `public/js/app.js` | 所有页面状态、中文文案、管理流程、图表与紧凑模式的 UI 验收依据 |
| `public/css/styles.css` | 设计 tokens、布局、响应式断点、组件样式参考 |
| `scripts/verify.js` | 直接改造成 `packages/domain/test/analytics.golden.test.ts` + API 集成 golden |

---

## 6. 验证方式

```bash
# 安装与静态检查
npm ci
npm run typecheck && npm run lint && npm run build

# 数据库
docker compose up -d postgres redis
npm run db:migrate
npm run seed -- --demo-records
npm run test:golden

# 单测 + 集成
npm run test

# 本地开发（API 8787，Vite 5173）
npm run dev

# 端到端
npm run test:e2e

# 生产形态
docker compose -f deploy/compose.prod.yml up --build
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
```

手工验收：

- 首页/看板显示 24 / 5 / 58 / 74.3% / 86.4 / 165.3；Python 筛选 17 / 55.9%。
- 视频可播放、可拖动（`Range: bytes=0-99` → 206）。
- 注册 → 验证 → 登录 → MFA 设置/启用/恢复码登录 → 修改密码 → 重置密码。
- 学习者访问 `/admin`、写记录、导出 CSV 均被拒绝；管理员全部可用。
- CSV 导入后指标变化，恢复示例数据后回到 golden。
- 390px 宽度下图表紧凑、导航可用。
- 旧 `#/dashboard` 等链接自动跳到新路径。

---

## 7. 主要风险与缓解

| 风险 | 缓解 |
|---|---|
| 指标口径漂移 | analytics 纯函数逐行移植；纯函数 + HTTP 双层 golden；v2 不在 SQL 里重算 |
| 限流跨实例语义变化 | Redis Lua 固定窗口，键/阈值/成功清除完全对齐；双实例测试 |
| 令牌过期修复引发兼容问题 | 作为安全变更记录；MFA 过期返回可读文案；测试覆盖 |
| 课程改成 course_id 引发回归 | 视图/join 保持 API 形状；改名/删除/CSV 专项测试 |
| 视频三态迁移错误 | 导入器显式映射 NULL/`"null"`/对象；管理端三选一；测试覆盖 |
| 最后管理员并发竞争 | 事务 + advisory lock/行锁；并发测试 |
| Argon2 原生依赖 | `@node-rs/argon2` 预编译 + Debian slim 镜像；CI 构建验证 |
| 丢失零依赖离线演示 | `v1.2.0` tag + README/DEMO_GUIDE 指向；不删除 tag |
| 时间/日期时区漂移 | `date` 按字符串返回；UTC 日期运算；非 UTC `TZ` 测试 |
| 审计被未来代码改写 | 应用不暴露写接口；生产账号最小权限；保留期方案后续 |
| 重写周期长 | 里程碑可独立验收；M6 后即有可演示纵向切片；P1 可裁剪 |

---

## 8. 明确不做（v2.0.0 之后）

SSO/OIDC/SAML/SCIM、多租户与细粒度 RBAC、审计保留/归档/WORM、Prometheus/OTel/Sentry、CSP nonce、视频上传/转码/HLS/CDN、邮件重试与退信、密码泄露检测/Passkey、UI 国际化、会话设备管理、超大数据的物化视图、WAL/PITR、CSV 公式注入转义。

---

## 9. 文档与追踪维护规则

1. 架构、接口形状、数据模型或验收口径变化，先更新本文，再改代码。
2. 新增/拆分功能时，在 `docs/features/` 新建一个特性文件，并在 `FEATURE_TRACKER.xlsx` 增加一行、填好链接。
3. 状态流转：`未开始 → 进行中 → 待验收 → 已完成`；阻塞或取消记 `已搁置`，并在备注说明原因。
4. 每个特性完成时，必须把验收项勾选完，并在追踪表更新状态与完成日期。
5. 关键选型变更写入 `docs/DECISIONS.md`（ADR：背景、决策、替代方案、影响）。
6. 提交信息不包含任何助手署名或生成标记。

---

## 10. 实施顺序（M0）

1. `next` 分支（已创建）。
2. 落盘本文、`FEATURE_TRACKER.xlsx`、`docs/features/` 51 个特性文件。
3. 建 workspace 根配置与 `apps/*`、`packages/*` 骨架。
4. 建 CI 骨架与 `.env.example`。
5. 从 M1 开始按追踪表逐项实现。