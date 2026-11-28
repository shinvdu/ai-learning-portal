# AI Learning Portal v2

**AI 学习与数据分析门户** —— 课程广场、课程详情、章节学习、知识中心、学习看板和数据洞察的生产级重写。所有 KPI 都由 PostgreSQL 中的原始学习记录计算：改一条数据，指标与图表立即变化。

[English](README.en.md) · [目标架构](docs/ARCHITECTURE_V2.md) · [架构决策](docs/DECISIONS.md) · [本地开发](docs/DEVELOPMENT.md) · [API](docs/API.md) · [部署](docs/DEPLOYMENT.md) · [演示指南](docs/DEMO_GUIDE.md) · [生产就绪度](docs/PRODUCTION_READINESS.md) · [变更日志](CHANGELOG.md) · [安全策略](SECURITY.md) · [贡献指南](CONTRIBUTING.md)

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](#技术栈)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](#技术栈)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](#技术栈)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **版本说明**：`v2.0.0` 是产品级重写（Node.js + PostgreSQL + Redis + Vue 3 构建版），需要 Node ≥ 24 与容器基础设施。`v1.2.0` 标签永久保留为零依赖、SQLite、单文件的**离线教学版**，见 [v1.2.0 离线版](#c-v120-零依赖离线版)。
>
> 示例课程、章节、测验与学习记录全部为模拟数据；页面与文档不得包含真实姓名、账号或公司数据。

---

## 目录

- [功能](#功能)
- [技术栈](#技术栈)
- [架构](#架构)
- [快速开始](#快速开始)
- [指标口径与 golden 值](#指标口径与-golden-值)
- [安全](#安全)
- [API](#api)
- [项目结构](#项目结构)
- [开发与测试](#开发与测试)
- [P1 能力与已知限制](#p1-能力与已知限制)
- [许可证](#许可证)

---

## 功能

- **课程广场**：5 门课程卡片，分类筛选、关键字搜索、学习人数/完成率/成绩统计。
- **课程详情**：简介、讲师、难度、示例视频、带推断到达率的章节目录。
- **章节学习（30 章）**：讲义原文、示例视频（HTTP Range 支持拖动）、本章测验、到达率与全课程对比、上一章/下一章。
- **知识中心**：课程摘要、学习目标、知识点、术语、FAQ、3 道带答案与解析的测验、原文摘录、AI 初稿 → 人工修正对照。
- **学习看板**：5 个 KPI、6 张 ECharts 图表、课程筛选、数据源状态；管理员可展开数据演示面板。
- **数据洞察**：由记录动态生成的洞察、指标公式表、常见口径误区。
- **认证**：邮箱注册/登录/退出、邮箱验证、忘记/重置密码、TOTP MFA + 一次性恢复码、按账号锁定。
- **安全**：Argon2id 密码哈希（旧 scrypt 登录后透明升级）、PostgreSQL 会话（仅存 SHA-256）、CSRF 双提交 Cookie + 同源校验、Redis 固定窗口限流。
- **管理后台**：用户管理（角色/启停/密码/MFA/解锁）、课程与章节管理（视频三态）、审计日志、学习记录 CRUD、CSV 导入/导出/恢复示例数据，以及**数据快照**：每次导入/重置前自动快照，可一键恢复到任一快照（恢复本身也可回滚）。
- **API 文档**：由 zod 契约生成的 OpenAPI 3.1 规范（`/api/v1/openapi.json`）与 Scalar 交互式文档（`/api/v1/docs`）；生产可用 `ENABLE_API_DOCS` 开关。
- **媒体与邮件**：课程媒体支持本地磁盘或 S3/MinIO 两种存储驱动（`STORAGE_DRIVER`），邮件支持 webhook 或内置 SMTP（`MAIL_TRANSPORT=smtp`）。
- **运维**：Docker Compose 开发/生产编排、Nginx TLS/SPA/限流、`/healthz` 与 `/readyz`、结构化日志与 `X-Request-Id`、`pg_dump` 备份与恢复脚本。

## 技术栈

| 层 | 选型 |
|---|---|
| API | Express 5 + TypeScript (ESM) + zod + pino + helmet |
| Web | Vue 3 + Vite + Vue Router 5 + Pinia + ECharts 6，自建 CSS 设计系统 |
| 数据库 | PostgreSQL 16 + Drizzle ORM（SQL 迁移 + advisory lock） |
| 缓存/限流 | Redis 7（固定窗口限流，故障时降级为进程内 Map） |
| 密码/MFA | `@node-rs/argon2`（Argon2id）+ TOTP；MFA secret 用 AES-256-GCM 加密存储 |
| 运行时 | Node.js ≥ 24，npm workspaces |
| 交付 | Docker Compose + Nginx 1.27，可选 systemd |

## 架构

- 目标架构、模块边界、数据模型与验收基线：[docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md)
- 关键选型与取舍（ADR）：[docs/DECISIONS.md](docs/DECISIONS.md)
- API 规范路径 `/api/v1`，保留旧 `/api` 薄别名（带 `Deprecation` / `Link` 响应头）。

```
浏览器 ──HTTPS──> Nginx (TLS/HSTS/静态/SPA/边缘限流)
                    ├── /            -> Vue 构建产物
                    ├── /api/v1/*    -> API (8787)
                    └── /healthz,/readyz -> API（仅内网）
API ──> PostgreSQL 16（会话/用户/课程/记录/审计）
    └──> Redis 7（限流计数）
```

## 快速开始

### A) Docker Compose 生产形态演示

仓库根目录已提供 `deploy/compose.prod.yml`：不发布 PostgreSQL/Redis 主机端口，数据卷为独立的 `portal_prod_pgdata` / `portal_prod_redisdata`，不会影响开发栈。

```bash
# 1. 复制并填写生产环境模板（占位值必须替换）
cp deploy/env.example deploy/.env.prod
chmod 600 deploy/.env.prod
#   - DATABASE_URL 中的密码，例如 postgres://portal:<密码>@postgres:5432/ai_portal
#   - POSTGRES_PASSWORD：与 DATABASE_URL 中的密码相同（数据库初始化用）
#   - ADMIN_EMAIL / ADMIN_PASSWORD（首次启动创建管理员）
#   - MFA_ENC_KEY：openssl rand -base64 32
#   - MAIL_TRANSPORT=webhook + MAIL_WEBHOOK_URL（生产禁止 console）

# 2. deploy/.env.prod 同时保存 POSTGRES_PASSWORD；它必须与 DATABASE_URL 中的密码一致。
#    必须用 --env-file 传入，compose 会把这些值注入各服务（否则 DATABASE_URL 等不会进入容器）。
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod build
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod ps

# 3. 打开 http://127.0.0.1:8080 ，用 ADMIN_EMAIL / ADMIN_PASSWORD 登录
```

`migrate` → `seed` → `api` → `web` 按依赖顺序自动执行；`seed` 带 `--demo-records`，因此会导入 177 条示例记录。真实部署应去掉该参数并将 `SEED_DEMO_RECORDS`、`ALLOW_DEMO_RESET` 设为 `0`。生产 compose 的 `web` 只监听 HTTP 8080，TLS 由边缘 Nginx 终止（见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)）。

> 生产模式要求可用的邮件传输。没有真实邮件网关时，管理员登录与浏览仍可用；注册、邮箱验证、找回密码会因网关不可达而报 `MAIL_FAILED`，演示前请配置 `MAIL_WEBHOOK_URL`。

### B) 本地开发

完整环境说明（端口、变量、日志、排障、数据库重置）见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

```bash
# 1. 启动基础设施（开发 compose 默认只启动这两个服务）
docker compose up -d postgres redis   # postgres 127.0.0.1:5433 / redis 127.0.0.1:6380

# 2. 安装依赖、加载本地环境变量
npm ci
cp .env.example .env
set -a; . ./.env; set +a              # 脚本不会自动读取 .env，需显式导出

# 3. 迁移 + 种子
npm run db:migrate
npm run seed                          # 开发环境默认导入 177 条示例记录

# 4. 同时启动 API 与 Vite（脚本自动加载 .env）
./scripts/dev-local.sh
# 或（已在当前 shell 导出 .env 时）：npm run dev
```

- Web：<http://127.0.0.1:5173>（Vite 将 `/api` 代理到 `http://127.0.0.1:8787`）
- API：<http://127.0.0.1:8787>，健康检查 `/healthz`、`/readyz`
- API 文档：<http://127.0.0.1:8787/api/v1/docs>（Scalar）；规范 <http://127.0.0.1:8787/api/v1/openapi.json>。开发/测试默认开放，生产需 `ENABLE_API_DOCS=1`。
- 默认管理员由 `.env` 的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 决定（`.env.example` 是 `admin@example.com` / `change-me-before-use` 占位；本机当前值见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，仅限本地，演示/生产前必须更换）

只启动 API：`npm run dev -w @portal/api`；只启动 Web：`npm run dev -w @portal/web`。

### C) v1.2.0 零依赖离线版

`v1.2.0` 标签是原零依赖 Node.js + SQLite + 原生前端版本，适合无 Docker、无 PostgreSQL/Redis 的教室环境：

```bash
git checkout v1.2.0
npm start          # 无需 npm install；http://127.0.0.1:8787
# 返回 v2：
git checkout next
```

v1.2.0 的数据为 `data/portal.db`（SQLite），与 v2 的 PostgreSQL 数据完全独立；回退切换不会改动 v2 数据。

## 指标口径与 golden 值

数据源：`packages/db/fixtures/learning_records.csv`（177 行，24 名学生，5 门课，2026-11-04 至 2026-11-17）。

| 指标 | 口径 | 值 |
|---|---|---|
| 学生数 | `student_id` 去重 | 24 |
| 课程数 | `course_name` 去重 | 5 |
| 选课数 | `student_id + course_name` 唯一组合 | 58 |
| 学习记录数 | CSV 行数 | 177 |
| 平均完成率 | 每条选课取 `max(chapters_done) / total_chapters`，再对选课求平均 | 74.3% |
| 平均测验成绩 | 只统计有成绩的选课（空成绩 ≠ 0 分） | 86.4（53 条有成绩 / 5 条无成绩） |
| 累计学习时长 | `learning_minutes` 求和 ÷ 60 | 9,916 分钟 / 165.3 小时 |
| 章节数 | 5 门课 × 6 章 | 30 |

分课程（学习人数 / 记录数 / 完成率 / 平均分）：

- 生成式 AI 基础：11 / 32 / 81.8 / 87.0
- 提示词工程入门：16 / 47 / 81.3 / 88.3
- Python 数据分析：17 / 53 / 55.9 / 81.1
- Web 前端开发实战：6 / 23 / 76.2 / 86.2
- AI 安全与负责任使用：8 / 22 / 87.5 / 90.3

章节到达率由总完成章节数**推断**，UI 明确标注；它不是逐章埋点数据。

## 安全

完整安全模型与漏洞报告方式见 [SECURITY.md](SECURITY.md)。要点：

- 密码 Argon2id；旧 scrypt 哈希登录成功后透明升级。
- 会话 token 为随机值，PostgreSQL 只存 SHA-256；Cookie `aip_session` 为 `HttpOnly` + `SameSite=Lax` + 7 天，HTTPS 下自动加 `Secure`。
- 一次性令牌（验证/重置/MFA challenge）**强制校验过期**（v1 的修复项）。
- MFA secret 以 AES-256-GCM 加密落库，密钥来自 `MFA_ENC_KEY`；轮换会使现有 MFA 注册失效。
- CSRF 双提交（`aip_csrf` Cookie + `X-CSRF-Token`），并对带 `Origin` 的写请求做同源校验。
- Redis 固定窗口限流：公开认证接口每 IP 20 次/10 分钟，账号级敏感接口每用户 10 次/10 分钟；Redis 故障降级为进程内计数。
- 审计只追加：认证、用户、课程/章节、记录 CRUD、CSV 导入导出、数据重置。
- 生产模式强制要求 `ADMIN_PASSWORD`、`MFA_ENC_KEY`、`PUBLIC_BASE_URL` 与非 console 邮件传输；启动时缺失即退出。

## API

- 规范前缀 `/api/v1`；旧 `/api` 别名复用同一 router，仅增加 `Deprecation: true` 与 `Link: <...>; rel="successor-version"`。
- 会话 Cookie + CSRF、错误封装、分页、全部端点表、审计动作与示例见 [docs/API.md](docs/API.md)。
- OpenAPI 3.1：`GET /api/v1/openapi.json` 始终可读；Scalar 文档 `GET /api/v1/docs` 在非生产环境或 `ENABLE_API_DOCS=1` 时开放，否则 404。媒体（`/media/{key}`）与数据快照端点也包含在规范中。

## 项目结构

```
.
├── apps/
│   ├── api/                 Express 5 API、seed CLI、媒体/OpenAPI 模块、SQLite 导入器、集成测试
│   │   └── Dockerfile       Debian slim + 非 root；Argon2 预编译依赖
│   └── web/                 Vue 3 + Vite SPA
│       ├── nginx/           容器内 HTTP 静态 + /api 代理
│       └── Dockerfile       Vite 构建 + nginx:1.27-alpine
├── packages/
│   ├── config/              环境变量 zod schema（开发默认/生产校验）
│   ├── contracts/           请求/响应与审计动作的 zod 契约
│   ├── content/             讲义、章节、测验、知识文档、常见误区
│   ├── db/                  Drizzle schema、SQL 迁移、fixtures、迁移 runner
│   └── domain/              纯函数：analytics/csv/totp/password/dates
├── deploy/
│   ├── compose.prod.yml     生产编排（不发布 PG/Redis 端口）
│   ├── env.example          生产环境模板（占位值）
│   ├── nginx/               边缘 TLS/HSTS/SPA/限流示例
│   └── systemd/             systemd 单元
├── scripts/                 backup.sh / restore.sh / healthcheck.sh / import-sqlite.sh
├── e2e/                     Playwright 冒烟
├── docs/                    架构、决策、API、部署、演示、就绪度
├── compose.yml              开发编排（postgres 5433 / redis 6380；可选 MinIO `media` profile）
└── package.json             npm workspaces 脚本
```

## 开发与测试

```bash
npm run typecheck     # tsc -b（全部 workspace）
npm run lint          # eslint
npm run build         # 构建所有 workspace（含 Web 静态产物）
npm test              # Vitest：单元 + API 集成（需 PG/Redis）
npm run test:e2e      # Playwright 冒烟
```

- 集成测试会自动创建 `ai_portal_test` 并应用迁移/种子，不触碰开发库。
- 演示数据的完整流程与验收清单见 [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md)。
- 每次发布前后的检查清单见 [docs/RELEASE_NOTES_v2.0.0.md](docs/RELEASE_NOTES_v2.0.0.md)。

## P1 能力与已知限制

以下 P1 能力已在 `next` 分支实现，**尚未发布**（`v2.0.0` 仍是最新发布版本）：

- **OpenAPI + Scalar（F036）**：`/api/v1/openapi.json` 与 `/api/v1/docs`，见 [API 文档](docs/API.md)。
- **CSV 快照与恢复（F064）**：导入/重置前自动快照，管理后台“数据快照”标签可恢复，见 [API 文档](docs/API.md)与[部署指南](docs/DEPLOYMENT.md)。
- **SMTP（F049 扩展）**：`MAIL_TRANSPORT=smtp` + `SMTP_URL`，见[部署指南](docs/DEPLOYMENT.md)。
- **媒体 local/S3（F094）**：`STORAGE_DRIVER` + `S3_*`，开发可用 MinIO `media` profile，见[本地开发](docs/DEVELOPMENT.md)。
- **SQLite → PostgreSQL 导入器（F100）**：`npm run import:sqlite`，先用 `--dry-run`，见[本地开发](docs/DEVELOPMENT.md)。

新增环境变量（完整默认值与生产要求见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 与 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `ENABLE_API_DOCS` | `0` | 生产开放 `/api/v1/docs`；非生产默认已开放 |
| `MAIL_TRANSPORT` | `console`（开发） | `webhook` / `smtp` / `console`；生产禁止 `console` |
| `SMTP_URL` | 空 | `MAIL_TRANSPORT=smtp` 时必填，`smtp://` 或 `smtps://` |
| `STORAGE_DRIVER` | `local` | `local` 或 `s3` |
| `MEDIA_DIR` | `./data/media` | 本地媒体目录 |
| `MEDIA_MAX_BYTES` | `52428800` | 单文件上传上限（约 50 MB） |
| `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | 空 | `STORAGE_DRIVER=s3` 时必填；密钥仅服务端使用 |
| `S3_ENDPOINT` | 空 | MinIO 必填（如 `http://127.0.0.1:9000`）；AWS 可省略 |
| `S3_REGION` | `us-east-1` | S3 区域 |
| `S3_FORCE_PATH_STYLE` | `1` | MinIO 需要路径风格访问 |
| `S3_PUBLIC_URL` | 空 | 可选的公开媒体域名，缺省用预签名 URL |

仍延后：Playwright 全量矩阵与覆盖率门禁（当前为 CI 冒烟）。同时不在范围内：SSO/OIDC/SAML、SCIM、多租户、资源级权限、审计保留/归档/WORM、Metrics/Tracing APM、强制管理员 MFA、WAL/PITR、CSP nonce。

详细风险与完成定义见 [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md)。

## 许可证

[MIT](LICENSE) © 2026 AI Learning Portal contributors