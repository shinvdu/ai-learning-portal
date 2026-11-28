# 部署指南（v2.1.0）

本文覆盖 v2 的三种交付形态：

1. **容器编排**：`deploy/compose.prod.yml`（PostgreSQL + Redis + migrate + seed + API + Web），推荐用于演示与单机生产。
2. **systemd + 边缘 Nginx**：非容器备选，API 监听 `127.0.0.1:8787`，Nginx 托管静态资源并终止 TLS。
3. **开发环境**：`compose.yml`（仅基础设施）或 `--profile full`（完整应用栈）。

> 架构与口径见 [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md)，就绪度与遗留风险见 [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)，API 见 [API.md](API.md)。

## 1. 前置条件

- Linux x86_64（或 Docker Desktop），Docker Engine 24+ / Docker Compose v2。
- 2 vCPU / 2 GB 内存 / 10 GB 磁盘起步（演示规模）。
- 一个域名与 TLS 证书（Let's Encrypt 即可）。
- 一个可用的邮件传输：能接收 HTTP POST 的网关（`MAIL_TRANSPORT=webhook`）或任意 SMTP 中继（`MAIL_TRANSPORT=smtp` + `SMTP_URL`）。
- 可选：非容器部署需要 Node.js ≥ 24、PostgreSQL 16、Redis 7。

端口约定：

| 组件 | 开发 compose | 生产 compose |
|---|---|---|
| PostgreSQL | 主机 `5433` → 容器 `5432` | **不发布主机端口** |
| Redis | 主机 `6380` → 容器 `6379` | **不发布主机端口** |
| API | 容器内 `8787`（`expose`） | 容器内 `8787`（`expose`） |
| Web | 主机 `8080` → 容器 `80` | 主机 `8080` → 容器 `80` |

## 2. 环境变量

生产模板：`deploy/env.example` → 复制为 `deploy/.env.prod`（`chmod 600`）。所有 `replace-with-*` 必须替换。

| 变量 | 生产要求 | 说明 |
|---|---|---|
| `APP_ENV` / `NODE_ENV` | `production` | 触发生产校验与默认值 |
| `DATABASE_URL` | 必填 | `postgres://<user>:<password>@postgres:5432/ai_portal`；容器内用服务名 |
| `MIGRATION_DATABASE_URL` | 可选 | 迁移专用连接串；缺省回退 `DATABASE_URL` |
| `REDIS_URL` | 必填 | `redis://redis:6379/0` |
| `PUBLIC_BASE_URL` | 必填 | 用户浏览器访问的 https 源，用于验证/重置链接 |
| `ADMIN_EMAIL` | 建议显式 | 首个管理员邮箱 |
| `ADMIN_PASSWORD` | 必填 | 首个管理员密码（≥8 字符）；不会打印到日志 |
| `MFA_ENC_KEY` | 必填 | AES-256-GCM 密钥材料，任意长随机串经 SHA-256 派生；`openssl rand -base64 32` |
| `MAIL_TRANSPORT` | 必填非 console | `webhook` 或 `smtp` |
| `MAIL_WEBHOOK_URL` | webhook 时必填 | 邮件网关 POST 地址 |
| `MAIL_WEBHOOK_TOKEN` | 可选 | 以 `Authorization: Bearer <token>` 发送 |
| `SMTP_URL` | smtp 时必填 | SMTP 连接串：`smtp://user:pass@host:587`（STARTTLS）或 `smtps://user:pass@host:465`（隐式 TLS）；密码含特殊字符时需 URL 编码 |
| `MAIL_FROM` | 可选 | 发件人展示名/地址 |
| `STORAGE_DRIVER` | `local` | `local`（API 卷上的 `MEDIA_DIR`）或 `s3`（S3/MinIO，多实例共享） |
| `MEDIA_DIR` | `./data/media` | 本地媒体目录；生产需在持久卷上并可写 |
| `MEDIA_MAX_BYTES` | `52428800` | 单文件上传上限（约 50 MB） |
| `MINIO_API_CORS_ALLOW_ORIGIN` | 仅 dev compose | 由 compose 的 `minio` 服务消费（API 不读）；允许浏览器预签名直传的源，逗号分隔。使用外部 MinIO 时在该服务侧配置；若上传经 API 代理可留空 |
| `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | s3 时必填 | 存储桶与凭据；凭据只在服务端使用，不下发前端 |
| `S3_ENDPOINT` | MinIO 必填 | 如 `http://minio:9000`（容器内）或 `http://127.0.0.1:9000`；AWS 可省略 |
| `S3_REGION` | `us-east-1` | S3 区域 |
| `S3_FORCE_PATH_STYLE` | `1` | MinIO 需路径风格；AWS 可设 `0` |
| `S3_PUBLIC_URL` | 可选 | 公开媒体域名（CDN/桶公开读）；缺省用预签名 GET |
| `SEED_DEMO_RECORDS` | 演示 `1`；真实 `0` | 是否导入示例记录 |
| `ALLOW_DEMO_RESET` | 演示 `1`；真实 `0` | 是否允许管理员“恢复示例数据”与 seed `--reset` |
| `LOG_LEVEL` | `info` | `fatal/error/warn/info/debug/trace` |
| `ENABLE_API_DOCS` | `0` | 设为 `1` 时生产开放 `GET /api/v1/docs`；`/api/v1/openapi.json` 始终可读 |
| `SERVE_WEB` | `0` | 生产由 Nginx 托管静态资源 |
| `TRUST_PROXY` | `1` | 信任 Nginx 的 `X-Forwarded-*` |
| `POSTGRES_USER/PASSWORD/DB` | 与 `DATABASE_URL` 一致 | 仅 compose 插值使用，不写入 API 容器 |

生产配置在进程启动时由 zod 校验；缺失 `DATABASE_URL`、`REDIS_URL`、`PUBLIC_BASE_URL`、`MFA_ENC_KEY`、`ADMIN_PASSWORD`、使用 `console` 邮件传输、`MAIL_TRANSPORT=smtp` 却缺 `SMTP_URL`，或 `STORAGE_DRIVER=s3` 却缺 `S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` 时直接退出。

## 3. 生产 Compose

```bash
cd /path/to/portal

# 1. 环境文件
cp deploy/env.example deploy/.env.prod
chmod 600 deploy/.env.prod
# 编辑 DATABASE_URL / POSTGRES_PASSWORD / ADMIN_* / MFA_ENC_KEY / MAIL_*
# POSTGRES_PASSWORD 必须等于 DATABASE_URL 中的密码。

# 2. 构建与启动；--env-file 把变量注入 migrate/seed/api（仅靠 shell 环境不够）
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod build
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d
docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod ps
```

服务顺序与语义：

- `postgres` / `redis`：健康检查通过后才继续；数据卷为 `portal_prod_pgdata` / `portal_prod_redisdata`，与开发栈的 `postgres_data` / `redis_data` 完全分离。
- `migrate`：一次性任务，执行 `node packages/db/dist/migrate.js`（Drizzle + `pg_advisory_lock` 防并发），失败会阻断后续服务。
- `seed`：一次性任务，执行 `node apps/api/dist/seed/seed.js --demo-records`；`ALLOW_DEMO_RESET` 默认 `0`（环境文件可覆盖）。
- `api`：非 root，`SERVE_WEB=0`，只在容器网络暴露 8787，健康检查 `/healthz`。
- `web`：Nginx 静态托管 + `/api` 反代到 `api:8787`，主机 8080。

自定义环境文件路径：直接把路径传给 `--env-file`，例如
`docker compose -p portalprod -f deploy/compose.prod.yml --env-file /etc/portal.env up -d`。
compose 只负责用该文件做变量插值；各服务的 `environment:` 已显式引用这些变量，因此无需额外的 `env_file`。

关闭演示数据（真实部署）：

```bash
# 编辑 deploy/compose.prod.yml 的 seed.command，去掉 --demo-records
sed -i 's/, "--demo-records"//' deploy/compose.prod.yml   # 或手工编辑
# 并在 deploy/.env.prod 设置
SEED_DEMO_RECORDS=0
ALLOW_DEMO_RESET=0
```

## 4. TLS 边缘 Nginx

生产 compose 的 `web` 只提供 HTTP。TLS/HSTS 必须由前置代理终止，否则验证/重置邮件链接与会话 `Secure` 行为不正确。

```bash
sudo cp deploy/nginx/portal.conf.example /etc/nginx/conf.d/portal.conf
sudo editor /etc/nginx/conf.d/portal.conf
```

要点：

- HTTP :80 → HTTPS 301；`/.well-known/acme-challenge/` 保留给证书续期。
- TLS 1.2/1.3、HSTS 1 年、`X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、CSP、COOP/CORP。
- 静态：`/assets/` 一年 immutable；`/index.html` 与 SPA fallback 为 no-cache；深链刷新返回 `index.html`。
- `/api/` 反代并做边缘限流（认证 20 r/m，其他 600 r/m）；请求体 **64m**（为 50 MB 媒体直传留余量；应用自身仍限 2 MB JSON 与 `MEDIA_MAX_BYTES` 原始体并返回标准 413）。
- CSP 需包含 `media-src 'self' blob:` 与 `img-src 'self' data: blob:`（上传前 blob 预览）；示例 `deploy/nginx/portal.conf.example` 已同步。不要为对象存储额外放开外站源——视频字段保存的是同源 `/api/v1/media/<key>`。
- `/healthz`、`/readyz` 仅允许回环/内网。
- 容器网络部署时，把示例中的 `127.0.0.1:8787` 改为 `api:8787`，并把 `root /var/www/ai-learning-portal` 改为反代 `web:80`（或挂载共享静态目录）。
- 确保 `PUBLIC_BASE_URL=https://<域名>`，并在代理设置 `X-Forwarded-Proto https`。

## 5. 迁移

- 生产：由 compose 的 `migrate` 一次性任务执行；多实例同时启动时 advisory lock 保证只应用一次。
- 手工执行：

```bash
DATABASE_URL='postgres://...' node packages/db/dist/migrate.js
# 或开发环境：
set -a; . ./.env; set +a
npm run db:migrate
```

- 迁移文件位于 `packages/db/drizzle/`（`0001_initial.sql` + `0002_chapter_video.sql`），journal 记录在 `drizzle.__drizzle_migrations`。
- **v2.0.0 → v2.1.0 需要迁移**：`0002_chapter_video.sql` 为 `chapters` 增加 `video_mode`（默认 `inherit`）与 `video` jsonb 及 CHECK 约束。升级、全新部署与导入 v1 数据前都必须先迁移。
- `/readyz` 会核对 journal 条目数，未迁移到最新时返回 503。
- 迁移脚本不提供自动回滚；回滚请使用备份恢复（见第 6 节）或代码回退到上一版本后人工处理。`0002` 仅新增列，应用回退到 v2.0.0 时多出的列会被忽略。

## 6. 备份与恢复

脚本：

- `scripts/backup.sh`：`pg_dump -Fc` → `pg_restore --list` 校验 → 按 `RETENTION_DAYS`（默认 14）清理 → 记录大小与路径。失败删除半成品。
- `scripts/restore.sh`：`pg_restore --clean --if-exists --no-owner --no-acl`，需输入 `restore` 或 `--yes`，完成后用 `psql` 校验 courses/chapters/knowledge/records 行数。
- `scripts/healthcheck.sh`：curl `/healthz` 与 `/readyz`，适合 cron/systemd/CI。

每日备份（在数据库主机或可访问数据库的跳板机）：

```bash
export DATABASE_URL='postgres://portal:<password>@127.0.0.1:5432/ai_portal'
export BACKUP_DIR=/var/backups/ai-learning-portal
./scripts/backup.sh

# cron，每天 02:17
17 2 * * * DATABASE_URL='postgres://...' BACKUP_DIR=/var/backups/ai-learning-portal /opt/ai-learning-portal/scripts/backup.sh >> /var/log/portal-backup.log 2>&1
```

容器环境可从容器内执行：

```bash
docker compose -p portalprod exec -T postgres \
  pg_dump -U portal -d ai_portal -Fc > /var/backups/portal-$(date +%F).dump
pg_restore --list /var/backups/portal-$(date +%F).dump >/dev/null
```

恢复演练（务必在预发或空库进行）：

```bash
export DATABASE_URL='postgres://portal:<password>@127.0.0.1:5432/ai_portal'
./scripts/restore.sh /var/backups/ai-learning-portal/portal-20261128-120000.dump
# 交互输入 restore，或加 --yes
./scripts/healthcheck.sh http://127.0.0.1:8787
```

恢复后校验 golden：24 名学生 / 5 门课 / 58 条选课 / 74.3% / 86.4 / 165.3 小时（见 [DEMO_GUIDE.md](DEMO_GUIDE.md)）。

WAL/PITR 不在 v2 范围，RPO 以最近一次 `pg_dump` 为准。

## 7. 健康检查与日志

```bash
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8787/readyz
./scripts/healthcheck.sh http://127.0.0.1:8787
```

- `/healthz`：仅进程存活。
- `/readyz`：PostgreSQL、Redis、迁移版本；任一失败 503；Redis 故障会让 readiness 降级，但登录/浏览仍可工作（限流退化为进程内）。
- API 日志为 pino JSON（stdout），字段含 `requestId`、`method`、`path`、`status`、`duration`、`userId`；敏感字段脱敏；响应头带 `X-Request-Id`。
- `docker compose -p portalprod -f deploy/compose.prod.yml logs -f api`。
- pino 输出到 stdout，建议由 Docker json-file / journald / 采集器统一收集；应用不内置轮转。

## 8. 多实例扩展

API 是无状态的（会话在 PostgreSQL、限流在 Redis），可以在 Nginx 后横向扩展：

```yaml
# compose 覆盖示例
services:
  api:
    deploy:
      replicas: 3
```

或 Nginx upstream：

```nginx
upstream portal_api_upstream {
    server 10.0.0.11:8787;
    server 10.0.0.12:8787;
    server 10.0.0.13:8787;
    keepalive 32;
}
```

要求：

- 所有实例共享同一个 `DATABASE_URL` 与 `REDIS_URL`。
- 迁移只运行一次（compose `migrate` 任务，或单独的 Job）；advisory lock 可防止并发重复应用。
- `TRUST_PROXY=1` 且代理正确设置 `X-Forwarded-For`，否则限流按代理 IP 计数。
- 健康检查指向每个实例的 `/readyz`。

## 9. 升级与回滚

升级：

```bash
git fetch --tags
git checkout v2.1.0        # 或更新的补丁 tag
export POSTGRES_PASSWORD='...'
docker compose -p portalprod -f deploy/compose.prod.yml build
./scripts/backup.sh        # 先备份
docker compose -p portalprod -f deploy/compose.prod.yml up -d
./scripts/healthcheck.sh http://127.0.0.1:8787
```

- `migrate` 会先于 API 运行并应用 `0002_chapter_video.sql`；迁移是向前兼容的基线，不自动回滚。
- 非 compose 部署务必在重启 API 前手工执行 `npm run db:migrate`（或 `node packages/db/dist/migrate.js`），否则 `/readyz` 返回 503 且章节查询会因缺列失败。
- `0002` 只新增可空/有默认值的列，回滚应用到 v2.0.0 不需要删列；但迁移 journal 会保留记录。

回滚到 v1.2.0（零依赖离线版）：

```bash
git checkout v1.2.0
npm start               # SQLite 模式，默认 http://127.0.0.1:8787
```

v1.2.0 使用 `data/portal.db`，不会读写 v2 的 PostgreSQL。若要回滚 v2 的一次失败升级，优先恢复升级前的 `pg_dump`，再 checkout 上一个 tag。

## 10. 邮件传输（webhook 与 SMTP）

生产必须使用 `webhook` 或 `smtp`，禁止 `console`。两种传输失败都会保留账号并返回 `502 {"code":"MAIL_FAILED"}`。

### 10.1 webhook

应用向 `MAIL_WEBHOOK_URL` POST：

```json
{
  "from": "AI Learning Portal <no-reply@example.com>",
  "to": "user@example.com",
  "subject": "验证你的邮箱 · AI Learning Portal",
  "text": "你好 ... https://learning.example.com/#/verify?token=...",
  "html": null
}
```

- 配置 `MAIL_WEBHOOK_TOKEN` 时附带 `Authorization: Bearer <token>`。
- 10 秒超时；非 2xx 视为失败，注册返回 `502 {"error":"账号已创建，但验证邮件发送失败...","code":"MAIL_FAILED"}`。
- 网关负责 SMTP/API 发送、SPF/DKIM/DMARC、退信与重试。

### 10.2 SMTP

内置 SMTP 传输通过 nodemailer 使用 `SMTP_URL`：

```bash
MAIL_TRANSPORT=smtp
SMTP_URL='smtps://no-reply%40example.com:app-password@smtp.example.com:465'
```

- `smtp://host:587` 使用 STARTTLS；`smtps://host:465` 使用隐式 TLS。用户名/密码含 `@`、`/`、`:` 等字符时必须 URL 编码（上例 `no-reply%40example.com`）。
- `MAIL_TRANSPORT=smtp` 但未设置 `SMTP_URL` 时进程启动即失败，不会静默回退到 webhook 或 console。
- 发件地址取 `MAIL_FROM`；请确保该域已配置 SPF/DKIM/DMARC，并按服务商要求使用应用专用密码。
- SMTP 发送失败只记录不含正文的错误日志（日志不会打印验证/重置链接）。
- 重试队列/退信处理仍不在范围内（见 §12）。

## 11. MFA 密钥轮换

- `MFA_ENC_KEY` 用于 AES-256-GCM 加密已存 TOTP secret。
- **轮换会使所有现有 MFA 注册无法解密**：受影响用户需管理员 `resetMfa`（或用户重新 setup）。
- 建议流程：发布通知 → 备份 → 更换 `MFA_ENC_KEY` → 滚动重启 → 逐个重置 MFA。
- 轮换前不要删除旧密钥记录；当前实现不支持双密钥解密。

## 12. P1 状态

将随 `v2.1.0` 发布（当前 `next`，待最终 tag；详见 [CHANGELOG.md](../CHANGELOG.md) `[2.1.0]`）：

- OpenAPI 3.1 + Scalar（见 §14）。
- CSV 数据集快照与恢复（见 [API.md](API.md) §8）。
- SMTP 传输（见 §10.2）。
- local/S3（MinIO）媒体存储与管理端上传 UI（见 §13）。
- 章节独立视频（迁移 `0002_chapter_video.sql`，见 §5）。
- SQLite → PostgreSQL 导入器（见 §15）。

仍不在范围：

- 邮件重试队列与退信处理。
- WAL/PITR、审计归档与只读副本。
- Playwright 全量矩阵与覆盖率门禁。

## 13. 媒体存储（local / S3 / MinIO）

`STORAGE_DRIVER=local` 为默认：文件保存在 API 可写的 `MEDIA_DIR`（默认 `./data/media`），由 `GET /api/v1/media/:key` 流式返回并支持 HTTP Range。`STORAGE_DRIVER=s3` 对接 S3/MinIO：应用签发短时预签名 URL（900 秒），浏览器 302 跳转或直传，凭据不进入前端。

管理端上传（F095）：课程/章节表单内可选择视频与封面文件。`local` 驱动把原始字节 POST 到 `POST /api/v1/admin/media/upload`（同源、带 CSRF，受 `MEDIA_MAX_BYTES` 限制）；`s3` 驱动由浏览器直接 PUT 预签名 URL，需要对象存储允许站点源的 CORS。表单保存的是稳定站内路径 `/api/v1/media/<key>`（响应字段 `path`），不是绝对/会过期的 `publicUrl`。Nginx 上传体上限已提高到 64m，CSP 允许 `media-src 'self' blob:`。

```bash
# 本地驱动（默认）
STORAGE_DRIVER=local
MEDIA_DIR=./data/media
MEDIA_MAX_BYTES=52428800

# S3 / MinIO
STORAGE_DRIVER=s3
S3_ENDPOINT=http://minio:9000
S3_BUCKET=portal-media
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<secret-key>
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=1
# S3_PUBLIC_URL=https://media.example.com   # 可选
```

MinIO 开发启动（compose `media` profile，主机端口 9000/9001）：

```bash
docker compose --profile media up -d minio minio-init
# 控制台 http://127.0.0.1:9001（默认 minioadmin/minioadmin）；minio-init 创建 S3_BUCKET
```

- 端口 9000/9001 若被占用，可在 compose 覆盖里改端口映射（如 `9010:9000`、`9011:9001`），并同步改 `S3_ENDPOINT`。
- 浏览器直传需 CORS：开发 compose 的 MinIO 读取 `MINIO_API_CORS_ALLOW_ORIGIN`（默认 `http://127.0.0.1:5173,http://localhost:5173`）。生产使用外部 MinIO 时，在其服务端配置对应的站点源；AWS S3 需配置桶 CORS。缺少 CORS 时上传会在预检失败，上传器会提示检查对象存储 CORS。
- `MEDIA_DIR` 必须位于持久卷；容器重建不会保留未挂载的本地媒体。S3 多实例共享同一桶。
- 多实例部署使用 `s3`，否则各实例只看到自己的本地磁盘。
- **备份策略不变**：`pg_dump` 只覆盖数据库；本地 `MEDIA_DIR` 与 S3 桶需单独备份/开启版本化。数据库恢复后，媒体对象可能需从对象存储或文件备份恢复。
- 把课程/章节视频指向对象：上传后把视频设为 `custom`，`src=/api/v1/media/<key>`（详见 [API.md](API.md) §8 媒体）。

## 14. OpenAPI 与 Scalar 文档

- `GET /api/v1/openapi.json`：OpenAPI 3.1 规范，始终可读、`Cache-Control: no-store`。
- `GET /api/v1/docs`：Scalar 交互文档，生产默认关闭；设置 `ENABLE_API_DOCS=1` 开放。页面对 jsDelivr 放宽 CSP，其余路由策略不变。
- 规范包含全部业务路由（含媒体与数据快照）；可用于生成客户端或导入 Postman。

## 15. SQLite 数据导入（v1 → v2）

有 v1 真实数据（`data/portal.db`）时，必须在切换到 v2 前导入；导入器只读打开 SQLite，在单个 PostgreSQL 事务中写入**已迁移**的目标库。

```bash
# 目标库必须先迁移
DATABASE_URL='postgres://portal:portal@127.0.0.1:5433/ai_portal_test' npm run db:migrate

# 1. 先 dry-run：只打印计数与差异，不写库
DATABASE_URL='postgres://portal:portal@127.0.0.1:5433/ai_portal_test' \
  npm run import:sqlite -- --dry-run

# 2. 正式导入（目标为空库时直接导入；需要清空导入器负责的表时加 --wipe，危险）
DATABASE_URL='postgres://portal:portal@127.0.0.1:5433/ai_portal_test' \
  npm run import:sqlite

# 3. 校验 golden：24/5/58/177/30
```

- 选项：`--db <path>`（默认 `data/portal.db`）、`--dry-run`、`--wipe`（先 `TRUNCATE` 导入器负责的表）、`--include-sessions`（仅导入未过期会话/令牌）、`--help`。也可用 `scripts/import-sqlite.sh`。
- **目标库警告**：`DATABASE_URL` 指向哪里就写哪里。务必指向 `ai_portal_test` 或专用临时库；**绝不指向 `ai_portal` 开发库或生产库**。默认 upsert 不会删除目标库中导入器表之外或额外的数据，只有 `--wipe` 才会清空这些表。
- 视频语义按 v1 映射：SQL NULL → `inherit`，JSON 字符串 `"null"` → `none`，对象 → `custom`。
- v1 明文 MFA secret 会用 `MFA_ENC_KEY` 加密；生产导入前必须设置该变量。
- 旧 scrypt 密码原样导入，首次登录后透明升级为 Argon2id。
- 导入完成后指标应与 golden 一致（24 学生 / 5 课程 / 58 选课 / 177 记录 / 30 章）。

## 16. systemd 备选

不使用容器时：

```bash
sudo cp deploy/systemd/ai-learning-portal.service /etc/systemd/system/
sudo editor /etc/systemd/system/ai-learning-portal.service   # 调整路径
sudo install -m 600 /dev/null /etc/ai-learning-portal.env
sudo editor /etc/ai-learning-portal.env                       # 参考 deploy/systemd/ai-learning-portal.env.example，HOST=127.0.0.1
sudo systemctl daemon-reload
sudo systemctl enable --now ai-learning-portal
```

静态资源由边缘 Nginx 托管（`npm run build -w @portal/web` 后复制 `apps/web/dist` 到 `/var/www/ai-learning-portal`），API 仅监听回环。systemd 单元已包含 `NoNewPrivileges`、`ProtectSystem=strict` 等硬化项；`ReadWritePaths` 仅放开 `data/` 与 `backups/`。