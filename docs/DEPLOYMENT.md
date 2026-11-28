# 部署指南（v2.0.0）

本文覆盖 v2 的三种交付形态：

1. **容器编排**：`deploy/compose.prod.yml`（PostgreSQL + Redis + migrate + seed + API + Web），推荐用于演示与单机生产。
2. **systemd + 边缘 Nginx**：非容器备选，API 监听 `127.0.0.1:8787`，Nginx 托管静态资源并终止 TLS。
3. **开发环境**：`compose.yml`（仅基础设施）或 `--profile full`（完整应用栈）。

> 架构与口径见 [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md)，就绪度与遗留风险见 [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)，API 见 [API.md](API.md)。

## 1. 前置条件

- Linux x86_64（或 Docker Desktop），Docker Engine 24+ / Docker Compose v2。
- 2 vCPU / 2 GB 内存 / 10 GB 磁盘起步（演示规模）。
- 一个域名与 TLS 证书（Let's Encrypt 即可）。
- 一个可接收 HTTP POST 的邮件网关（生产只支持 `webhook`；SMTP 为 P1）。
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
| `MAIL_TRANSPORT` | 必填非 console | `webhook`（当前生产唯一可用） |
| `MAIL_WEBHOOK_URL` | webhook 时必填 | 邮件网关 POST 地址 |
| `MAIL_WEBHOOK_TOKEN` | 可选 | 以 `Authorization: Bearer <token>` 发送 |
| `MAIL_FROM` | 可选 | 发件人展示名/地址 |
| `SEED_DEMO_RECORDS` | 演示 `1`；真实 `0` | 是否导入示例记录 |
| `ALLOW_DEMO_RESET` | 演示 `1`；真实 `0` | 是否允许管理员“恢复示例数据”与 seed `--reset` |
| `LOG_LEVEL` | `info` | `fatal/error/warn/info/debug/trace` |
| `ENABLE_API_DOCS` | `0` | 预留开关（OpenAPI 为 P1） |
| `SERVE_WEB` | `0` | 生产由 Nginx 托管静态资源 |
| `TRUST_PROXY` | `1` | 信任 Nginx 的 `X-Forwarded-*` |
| `POSTGRES_USER/PASSWORD/DB` | 与 `DATABASE_URL` 一致 | 仅 compose 插值使用，不写入 API 容器 |

生产配置在进程启动时由 zod 校验；缺失 `DATABASE_URL`、`REDIS_URL`、`PUBLIC_BASE_URL`、`MFA_ENC_KEY`、`ADMIN_PASSWORD` 或使用 `console` 邮件传输时直接退出。

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
- `/api/` 反代并做边缘限流（认证 20 r/m，其他 600 r/m）；请求体 3m（应用自身仍限 2MB 并返回标准 413）。
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

- 迁移文件位于 `packages/db/drizzle/`（当前基线 `0001_initial.sql`），journal 记录在 `drizzle.__drizzle_migrations`。
- `/readyz` 会核对 journal 条目数，未迁移到最新时返回 503。
- 迁移脚本不提供自动回滚；回滚请使用备份恢复（见第 6 节）或代码回退到上一版本后人工处理。

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
git checkout v2.0.0        # 或更新的补丁 tag
export POSTGRES_PASSWORD='...'
docker compose -p portalprod -f deploy/compose.prod.yml build
./scripts/backup.sh        # 先备份
docker compose -p portalprod -f deploy/compose.prod.yml up -d
./scripts/healthcheck.sh http://127.0.0.1:8787
```

- `migrate` 会先于 API 运行；迁移是向前兼容的基线，不自动回滚。

回滚到 v1.2.0（零依赖离线版）：

```bash
git checkout v1.2.0
npm start               # SQLite 模式，默认 http://127.0.0.1:8787
```

v1.2.0 使用 `data/portal.db`，不会读写 v2 的 PostgreSQL。若要回滚 v2 的一次失败升级，优先恢复升级前的 `pg_dump`，再 checkout 上一个 tag。

## 10. 邮件网关

生产仅支持 `webhook`。应用向 `MAIL_WEBHOOK_URL` POST：

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
- SMTP 内置传输为 P1：设置 `MAIL_TRANSPORT=smtp` 会在启动时明确报错，不会静默降级。

## 11. MFA 密钥轮换

- `MFA_ENC_KEY` 用于 AES-256-GCM 加密已存 TOTP secret。
- **轮换会使所有现有 MFA 注册无法解密**：受影响用户需管理员 `resetMfa`（或用户重新 setup）。
- 建议流程：发布通知 → 备份 → 更换 `MFA_ENC_KEY` → 滚动重启 → 逐个重置 MFA。
- 轮换前不要删除旧密钥记录；当前实现不支持双密钥解密。

## 12. P1 / 未实现项

- SMTP 传输（`MAIL_TRANSPORT=smtp`）与退信队列。
- MinIO/S3 媒体存储；当前媒体为打包静态资源。
- SQLite → PostgreSQL 导入器（F100）。有 v1 真实数据时必须先完成导入再切换，不能直接复用 v2 种子。
- OpenAPI/Scalar（`ENABLE_API_DOCS` 仅为预留）。
- WAL/PITR、审计归档与只读副本。

## 13. systemd 备选

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