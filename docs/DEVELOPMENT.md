# 本地开发环境（v2）

> 分支：`next` · 验证日期：2026-11-28 · 状态：已启动并验证
> 生产部署见 [DEPLOYMENT.md](DEPLOYMENT.md)；v1.2.0 零依赖离线版见文末。

## 1. 当前状态

| 项目 | 值 |
|---|---|
| Web（Vite） | <http://127.0.0.1:5173> |
| API（Express） | <http://127.0.0.1:8787> |
| 健康检查 | `/healthz`、`/readyz` |
| 本地管理员 | `admin@local.test` / `dev-admin-123`（**仅本地开发**） |
| 开发数据库 | `ai_portal`（PostgreSQL 16，容器端口 5433） |
| 缓存/限流 | Redis 7（容器端口 6380，开发用 DB 0） |
| 数据 | 5 门课 / 30 章 / 5 知识 / 177 条记录 |
| golden 指标 | 24 学生 / 5 课程 / 58 选课 / 74.3% / 86.4 / 165.3h |
| 进程 | `npm run dev`（`tsx watch` + `vite`）；当前后台实例日志 `/tmp/portal-dev.log` |

已实际验证：`/healthz` 200、`/readyz` 200、Vite 200、`/api/v1/meta` 返回 golden 值、管理员登录 200、`/api/v1/dashboard?course=Python 数据分析` 返回 17 人 / 55.9%。

## 2. 版本与前提

| 工具 | 本机版本 | 要求 |
|---|---|---|
| Node.js | v24.19.0 | **≥ 24**（Vite 8、tsx、内置 fetch） |
| npm | 11.17.0 | 使用根 lockfile；`npm ci` |
| Docker | 29.7.2 | 运行 PostgreSQL/Redis 容器 |
| Docker Compose | v5.5.0 | `docker compose` |
| PostgreSQL | 16.16（容器） | 宿主机 5433 → 容器 5432 |
| Redis | 7.4.12（容器） | 宿主机 6380 → 容器 6379 |

宿主机另外可能已有 PostgreSQL 5432 / Redis 6379，本项目**不使用**这两个端口。

## 3. 首次装配

```bash
cd /mnt/app/pim/tmp/aiworkshop/portal

# 1. 依赖（使用 lockfile）
npm ci

# 2. 基础设施（开发 compose 默认只启动这两个服务）
docker compose up -d postgres redis
docker compose ps

# 3. 本地环境变量（.env 已被 .gitignore 忽略）
cp .env.example .env
chmod 600 .env
# 编辑 ADMIN_EMAIL / ADMIN_PASSWORD；MAIL_FROM 含空格，必须保留引号

# 4. 迁移 + 种子（开发默认导入 177 条示例记录）
set -a; . ./.env; set +a
npm run db:migrate
npm run seed

# 5. 启动 API + Vite（脚本会自动加载 .env）
./scripts/dev-local.sh
```

`./scripts/dev-local.sh` 等价于：

```bash
set -a; . ./.env; set +a
npm run dev
```

`.env` **不会**被 npm 脚本自动读取；直接在 shell 里运行 `npm run dev` 前必须先导出环境变量。

## 4. 端口与服务

| 服务 | 地址 | 说明 |
|---|---|---|
| Vite | `127.0.0.1:5173` | 开发 UI；`/api` 代理到 8787，`changeOrigin:false` |
| API | `127.0.0.1:8787` | `/api/v1`；旧 `/api` 别名；`/healthz`、`/readyz` |
| PostgreSQL | `127.0.0.1:5433` | 用户 `portal` / 密码 `portal`；数据库 `ai_portal` |
| Redis | `127.0.0.1:6380` | 开发 DB 0；测试 DB 15 |
| 测试库 | `127.0.0.1:5433/ai_portal_test` | `npm test` 使用；与 `ai_portal` 隔离 |
| 生产 compose | `127.0.0.1:8080` | `deploy/compose.prod.yml`，本地开发不启动 |

Vite 的代理目标可通过 `VITE_API_TARGET` 覆盖（默认 `http://127.0.0.1:8787`）：

```bash
VITE_API_TARGET=http://127.0.0.1:8788 npm run dev -w @portal/web
```

`SERVE_WEB=1` 时 API 也会托管 `apps/web/dist`，但开发时请使用 5173 的 Vite（热更新）。

## 5. 环境变量

本机 `.env` 的当前值（均为本地开发值，不要用于生产）：

| 变量 | 值 | 说明 |
|---|---|---|
| `APP_ENV` / `NODE_ENV` | `development` | 开发模式；生产需 `production` |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | API 监听 |
| `DATABASE_URL` | `postgres://portal:portal@127.0.0.1:5433/ai_portal` | 开发库 |
| `REDIS_URL` | `redis://127.0.0.1:6380/0` | 开发 Redis DB |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:5173` | 邮件链接基址 |
| `ADMIN_EMAIL` | `admin@local.test` | 首次启动引导管理员 |
| `ADMIN_PASSWORD` | `dev-admin-123` | 仅本地；生产必须替换 |
| `MFA_ENC_KEY` | 32 字节 base64 测试值 | MFA secret 加密；生产必须独立生成 |
| `MAIL_TRANSPORT` | `console` | 开发打印收件人与主题（不打印正文）；生产用 `webhook` 或 `smtp` |
| `MAIL_FROM` | `'AI Learning Portal <no-reply@local.test>'` | **含空格/尖括号，必须加引号** |
| `SMTP_URL` | 未设置 | 仅 `MAIL_TRANSPORT=smtp` 需要；如 `smtp://user:pass@127.0.0.1:1025`（本地可用 Mailpit/MailHog） |
| `STORAGE_DRIVER` | `local` | `local` 或 `s3`（本地开发一般保持 `local`） |
| `MEDIA_DIR` | `./data/media` | 本地媒体目录（gitignored） |
| `MEDIA_MAX_BYTES` | `52428800` | 单文件上传上限 |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | 未设置 | 仅 `STORAGE_DRIVER=s3` 需要；MinIO 用 §13 的 profile 提供 |
| `S3_REGION` / `S3_FORCE_PATH_STYLE` / `S3_PUBLIC_URL` | `us-east-1` / `1` / 空 | MinIO 默认路径风格 |
| `SEED_DEMO_RECORDS` | `1` | 允许示例记录 |
| `ALLOW_DEMO_RESET` | `1` | 允许开发环境重置示例数据 |
| `SERVE_WEB` | `1` | API 托管已构建前端；开发 UI 仍在 5173 |
| `LOG_LEVEL` | `info` | pino 日志级别 |
| `ENABLE_API_DOCS` | `0` | 生产开放 `/api/v1/docs` 的开关；开发环境（`APP_ENV=development`）默认已开放，无需设置 |
| `VITE_API_TARGET` | 未设置（默认 8787） | 仅 Vite 代理使用 |

生产模板见 `deploy/env.example`；`.env.example` 仅用于本地起步。`.env` 权限应为 `600`，不要提交。

## 6. 登录与管理员

- 首次启动时，如果没有任何活跃管理员，API 会用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 创建或提升管理员。
- 当前本机：`admin@local.test` / `dev-admin-123`。
- 管理员登录后可从头部进入 `管理后台`，在 `/account` 修改密码、启用 MFA。
- 本地管理员丢失/忘记密码（**开发库，破坏性**）：

```bash
set -a; . ./.env; set +a
psql "$DATABASE_URL" -c "delete from users where email='admin@local.test';"
# tsx watch 会重启 API；或重新运行 ./scripts/dev-local.sh
```

删除用户会级联删除其会话/令牌/恢复码，审计记录的 actor 置空。若库里还有其他活跃管理员，引导逻辑不会重建，需先处理其他管理员。

## 7. 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 同时启动 API + Vite（需先导出 `.env`） |
| `./scripts/dev-local.sh` | 自动加载 `.env` 后启动两者 |
| `npm run dev -w @portal/api` | 只启动 API（8787） |
| `npm run dev -w @portal/web` | 只启动 Vite（5173） |
| `npm run typecheck` | `tsc -b` 全仓类型检查 |
| `npm run lint` | ESLint |
| `npm test` | Vitest：domain/content/contracts/config + API 集成（150 项） |
| `npm run test:e2e` | Playwright smoke（需先 build + 准备数据库） |
| `npm run build` | 构建所有 workspace（含 Vue） |
| `npm run db:migrate` | 应用 `packages/db/drizzle` 迁移 |
| `npm run seed` | 课程/章节/知识/示例记录种子（开发默认导入记录） |
| `npm run db:generate` | 修改 Drizzle schema 后生成迁移 |
| `npm run import:sqlite -- --dry-run` | v1 SQLite → PostgreSQL 导入器（只校验，见 §14） |
| `./scripts/import-sqlite.sh` | 同上，带 `DATABASE_URL` 检查的封装脚本 |
| `./scripts/backup.sh` | `pg_dump -Fc` 到 `backups/` |
| `./scripts/restore.sh` | 恢复备份（需 `--yes` 或交互确认） |
| `./scripts/healthcheck.sh` | 检查 `/healthz` 与 `/readyz` |

测试/端到端**不要指向 `ai_portal`**：`npm test` 使用 `ai_portal_test` + Redis DB 15；E2E 建议使用一次性 `ai_portal_e2e`（CI 会自动创建并在结束后清理）。

E2E 本地示例：

```bash
npm run build
export DATABASE_URL=postgres://portal:portal@127.0.0.1:5433/ai_portal_e2e
npm run db:migrate
npm run seed -- --demo-records
npx playwright install chromium      # 首次
PLAYWRIGHT_API_PORT=8788 npm run test:e2e
```

## 8. 数据库与 golden 口径

```bash
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "select
  (select count(*) from courses) as courses,
  (select count(*) from chapters) as chapters,
  (select count(*) from knowledge) as knowledge,
  (select count(*) from records) as records;"
```

当前应为 `5 / 30 / 5 / 177`。指标口径与 golden 值见 [README.md](../README.md#指标口径与-golden-值)；任何页面数字都由 API 从数据库计算，不允许写死。

开发库重置（**破坏性**，会删除所有课程/记录/用户等）：

```bash
docker compose down -v          # 删除容器与 PG/Redis 数据卷
docker compose up -d postgres redis
set -a; . ./.env; set +a
npm run db:migrate
npm run seed
```

只重置 schema 时，必须同时删除 `public` 和 `drizzle`（Drizzle 的迁移 journal 在 `drizzle` schema）：

```bash
psql "$DATABASE_URL" -c "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;"
npm run db:migrate
npm run seed
```

## 9. 日志与排障

**查看进程与端口**

```bash
ss -ltnp | grep -E '5173|8787|5433|6380'
docker compose ps
```

**8787 被占用**：常见是 v1 的 `node server.js` 仍在运行。找到 PID 后停止，或换端口：

```bash
ss -ltnp | grep 8787          # 找到 PID
kill <PID>
# 或：PORT=8788 + VITE_API_TARGET=http://127.0.0.1:8788
```

不要使用宽泛的 `pkill -f node`。

**Vite 502 / API 连不上**：先确认 `curl http://127.0.0.1:8787/readyz`；未启动则重新运行 `./scripts/dev-local.sh`。

**配置启动失败**：API 启动时会 fail-fast 列出缺失变量。检查 `.env` 是否已导出；含空格的值（尤其是 `MAIL_FROM`）必须加引号，否则 `source` 会报 `unexpected token`。

**CSRF 403**：浏览器请求必须带 `aip_csrf` cookie 与 `X-CSRF-Token`，且 `Origin` 与 `Host` 同源。用 UI 操作最省事；无 `Origin` 的 curl 会按设计放行。

**数据库未就绪**：

```bash
docker compose ps
pg_isready -h 127.0.0.1 -p 5433 -U portal
```

**管理员登录失败**：确认 `.env` 的 `ADMIN_EMAIL`/`ADMIN_PASSWORD`；引导逻辑只在“没有活跃管理员”时创建。按第 6 节重置本地管理员。

**依赖/版本问题**：必须 Node ≥ 24；先 `npm ci`，不要用 `npm install` 改 lockfile。

**日志位置**：前台启动输出到终端；当前后台实例在 `/tmp/portal-dev.log`。API 为 pino JSON，含 `req.id`；响应头 `X-Request-Id`。

## 10. 关键文件

| 路径 | 说明 |
|---|---|
| `.env` | 本地开发变量（gitignored，`600`） |
| `.env.example` | 本地模板（`MAIL_FROM` 已加引号） |
| `compose.yml` | 开发基础设施；`--profile full` 可起 API/Web 容器 |
| `scripts/dev-local.sh` | 加载 `.env` 并启动 API + Vite |
| `packages/db/drizzle/` | 版本化 SQL 迁移 |
| `packages/db/fixtures/learning_records.csv` | 177 条示例记录 |
| `apps/api/test/` | Vitest + supertest 集成测试 |
| `e2e/` + `playwright.config.ts` | Playwright smoke |
| `deploy/` | 生产 compose、Nginx、systemd、env 模板 |

## 11. v1.2.0 离线版与端口冲突

v1.2.0 是零依赖 Node + SQLite 离线版，同样默认 8787：

```bash
git checkout v1.2.0
npm start          # http://127.0.0.1:8787，使用 data/portal.db
git checkout next  # 回到 v2
```

v1 与 v2 数据完全独立（SQLite 文件 vs PostgreSQL）。切换前先停止另一套 8787 进程。

## 12. 当前验证记录

- `/healthz`：200 `{"ok":true}`
- `/readyz`：200 `{"ok":true}`（PG + Redis + 迁移）
- Vite：200
- `/api/v1/meta`：24 / 5 / 58 / 74.3 / 86.4 / 165.3
- 登录：`admin@local.test` 200，返回 `role=admin`
- Python 数据分析筛选：17 人 / 55.9% / 81.1
- 数据库：5 课程 / 30 章节 / 5 知识 / 177 记录
- 测试：`npm test` 150 项通过；CI E2E 8 项通过

## 13. 媒体存储与 MinIO（本地）

默认 `STORAGE_DRIVER=local`，上传文件落在 `MEDIA_DIR`（默认 `./data/media`），由 `GET /api/v1/media/:key` 流式返回并支持 Range。需要验证 S3 路径时，用 compose 的 `media` profile 起 MinIO（不会随默认 `docker compose up` 启动）：

```bash
docker compose --profile media up -d minio minio-init
docker compose --profile media ps
# MinIO API 127.0.0.1:9000；控制台 127.0.0.1:9001（默认 minioadmin/minioadmin）
# minio-init 会按 S3_BUCKET（默认 portal-media）创建桶
```

然后在 `.env` 中切换驱动（示例值仅为本地）：

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=portal-media
S3_ACCESS_KEY=minioadmin    # MinIO 本地默认值，仅开发；生产必须替换
S3_SECRET_KEY=minioadmin    # MinIO 本地默认值，仅开发；生产必须替换
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=1
```

重启 API 后，管理端“课程管理 → 视频 → custom”可填 `src=/api/v1/media/<key>`；也可直接调 `POST /api/v1/admin/media/presign` 获取预签名 PUT 并上传。

- 端口 9000/9001 被占用时，在 compose 覆盖里改成 `9010:9000` / `9011:9001`，并同步 `S3_ENDPOINT`。
- 本地媒体在 `data/media`，默认不纳入 git；`docker compose down -v` 不会删除宿主机目录，但会删 MinIO 的 `minio_data` 卷。
- 不想用 S3 时把 `STORAGE_DRIVER` 改回 `local` 即可，公开页面不受影响。

## 14. SQLite 导入器（本地演练）

`npm run import:sqlite` 把 v1 的 `data/portal.db` 导入到**已迁移**的 PostgreSQL。源库只读打开，写入在单个事务中完成。

```bash
# 目标：测试库（绝不要用 ai_portal 开发库）
export DATABASE_URL=postgres://portal:portal@127.0.0.1:5433/ai_portal_test
npm run db:migrate

# 1. dry-run：只打印计数与差异，不写库
npm run import:sqlite -- --dry-run

# 2. 正式导入
npm run import:sqlite

# 3. 校验 golden
psql "$DATABASE_URL" -c "select
  (select count(*) from courses) courses,
  (select count(distinct student_id) from records) students,
  (select count(*) from records) records,
  (select count(*) from chapters) chapters;"
```

选项：

| 选项 | 作用 |
|---|---|
| `--db <path>` | 源 SQLite 文件，默认 `data/portal.db` |
| `--dry-run` | 只校验并打印计数/差异，绝不写库 |
| `--wipe` | 导入前 `TRUNCATE` 导入器负责的表（**危险**） |
| `--include-sessions` | 额外导入未过期的会话/令牌（默认跳过） |

- **目标库警告**：`DATABASE_URL` 指向哪里就写哪里。只用 `ai_portal_test` 或一次性临时库；不要指向 `ai_portal`，更不要指向生产库。默认 upsert 不会删除目标库额外数据，只有 `--wipe` 会清空导入器负责的表。
- 源库缺少可选表（`audit_log`/`mfa_recovery_codes`/`sessions`/`auth_tokens`）不报错；必需表缺失会失败。
- v1 明文 MFA secret 用 `MFA_ENC_KEY` 加密（开发可留空，自动派生开发密钥；生产必须显式设置）。
- 重复运行是幂等的（保留 id、upsert）；导入后旧 scrypt 密码可登录并透明升级。

## 15. API 文档（本地）

开发环境默认开放文档，无需改 `.env`：

- Scalar UI：<http://127.0.0.1:8787/api/v1/docs>
- OpenAPI 3.1：<http://127.0.0.1:8787/api/v1/openapi.json>

生产默认关闭 `/docs`，需 `ENABLE_API_DOCS=1`；`openapi.json` 始终可读。旧 `/api` 前缀同样可访问这两个端点。