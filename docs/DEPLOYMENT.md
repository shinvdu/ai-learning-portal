# 单节点生产部署（最小集）

本文描述当前仓库支持的**最小生产形态**：单台服务器、Node.js 进程、SQLite + 文件备份、反向代理终止 TLS。适用于校内/小团队受控试点，不适用于多实例或多租户 SaaS。

> 更完整的生产化清单见 [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)。PostgreSQL、Redis 会话/限流、对象存储与队列仍未内置。

## 1. 前置条件

- Linux 服务器，Node.js ≥ 24。
- 一个域名与 TLS 证书（Let's Encrypt 即可）。
- 一个能接收 HTTP POST 的邮件网关（Resend、SendGrid、内部 SMTP relay 等），用于验证与重置邮件。
- 反向代理（Nginx 示例见 `deploy/nginx.conf.example`）。
- 独立系统用户 `ai-portal`，数据目录仅该用户可读写。

## 2. 必需环境变量

可直接从 `deploy/env.example` 复制为 `/etc/ai-learning-portal.env`（`chmod 600`），再修改域名、数据库路径与凭据。

```bash
APP_ENV=production
PORT=8787
HOST=127.0.0.1
TRUST_PROXY=1

PORTAL_DB=/var/lib/ai-learning-portal/portal.db
PUBLIC_BASE_URL=https://learning.example.com

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD='a-long-random-password'

MAIL_WEBHOOK_URL=https://mail-relay.example.com/send
MAIL_WEBHOOK_TOKEN='relay-bearer-token'
MAIL_FROM='AI Learning Portal <no-reply@example.com>'

# 生产默认不导入示例学习记录；只有显式设置 1 才会导入。
SEED_DEMO_RECORDS=0
```

生产模式启动会强制检查：

- `ADMIN_PASSWORD` 至少 8 字符（首次创建管理员）。
- `PUBLIC_BASE_URL` 与 `MAIL_WEBHOOK_URL` 必须存在。
- 不会把生成的管理员密码打印到日志。
- 默认跳过 `learning_records.csv` 示例数据（课程/知识/章节仍会初始化）。
- 生产环境会禁用后台“恢复示例数据”与 `npm run seed`，除非显式设置 `ALLOW_DEMO_RESET=1` / `FORCE_SEED=1`。

## 3. 邮件网关契约

应用会向 `MAIL_WEBHOOK_URL` 发送 JSON：

```json
{
  "from": "AI Learning Portal <no-reply@example.com>",
  "to": "user@example.com",
  "subject": "验证你的邮箱 · AI Learning Portal",
  "text": "你好 ... https://learning.example.com/#/verify?token=..."
}
```

- 请求头 `Authorization: Bearer <MAIL_WEBHOOK_TOKEN>`（配置了才会发送）。
- 返回 2xx 视为发送成功；非 2xx 会让注册返回 `MAIL_FAILED`。
- 网关负责 SMTP/API 发送、SPF/DKIM/DMARC、退信处理。

## 4. 首次部署

```bash
sudo useradd --system --home /opt/ai-learning-portal --shell /usr/sbin/nologin ai-portal
sudo mkdir -p /opt/ai-learning-portal /var/lib/ai-learning-portal /opt/ai-learning-portal/backups
sudo chown -R ai-portal:ai-portal /opt/ai-learning-portal /var/lib/ai-learning-portal
# 将代码放至 /opt/ai-learning-portal
sudo -u ai-portal bash -c 'set -a; . /etc/ai-learning-portal.env; set +a; cd /opt/ai-learning-portal && exec node server.js'
```

或直接使用 `deploy/ai-learning-portal.service`，由 systemd 读取 `EnvironmentFile`。

首次启动会：

1. 执行版本化 migration（`schema_migrations`）。
2. 初始化课程、知识、章节。
3. 创建管理员（使用 `ADMIN_EMAIL` / `ADMIN_PASSWORD`）。
4. **不导入**示例学习记录（生产模式）。

管理员首次登录后：

- 在 `/account` 修改密码。
- 启用 MFA，并保存恢复码。
- 创建需要的账号/课程。

## 5. 反向代理与 systemd

- 参考 `deploy/nginx.conf.example`：TLS、HSTS、安全头、`X-Forwarded-Proto`、认证接口限流、请求体 2MB。
- 参考 `deploy/ai-learning-portal.service`：`EnvironmentFile`、非 root、只读文件系统、仅允许数据与备份目录写入。
- 应用只监听 `127.0.0.1`，由代理对外。
- `/healthz`、`/readyz` 仅允许内网/本机访问。

## 6. 备份与恢复

创建一致性备份：

```bash
sudo -u ai-portal npm run backup
# 或指定目录
sudo -u ai-portal BACKUP_DIR=/var/backups/ai-learning-portal npm run backup
```

- 备份使用 SQLite `VACUUM INTO`，包含 schema_migrations、用户、课程、记录与审计日志。
- 建议 cron/systemd timer 每日至少一次，并复制到异机/对象存储。
- 保留周期按合规要求设置（例如 30/90 天）。

恢复：

```bash
sudo systemctl stop ai-learning-portal
sudo -u ai-portal cp /var/backups/ai-learning-portal/portal-....db /var/lib/ai-learning-portal/portal.db
sudo rm -f /var/lib/ai-learning-portal/portal.db-wal /var/lib/ai-learning-portal/portal.db-shm
sudo systemctl start ai-learning-portal
curl -fsS http://127.0.0.1:8787/readyz
```

每季度至少做一次恢复演练并记录耗时。

## 7. 升级与 migration

- 部署新版本后启动进程会自动执行未应用的 migration。
- 升级前先跑一次 `npm run backup`。
- 迁移失败会回滚当前 migration；查看日志并恢复备份。
- 当前 migration 只支持向前（无 down），回滚依赖数据库备份。

## 8. 管理员恢复与 MFA

- 忘记密码：`ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:reset`（撤销该账号所有会话）。
- 用户丢失 MFA：管理员在后台“重置 MFA”，用户重新绑定。
- 登录失败 5 次会锁定 15 分钟；管理员可在用户表“解锁”。

## 9. 健康检查、日志与监控

- `GET /healthz`：进程存活。
- `GET /readyz`：SQLite 可查询。
- 目前日志输出到 stdout；请由 systemd/journald 或容器日志收集。
- 生产建议接入：日志聚合、Prometheus 指标、Sentry/错误告警、外部 uptime 检查。当前仓库未内置这些 exporter。

## 10. 单节点限制

- 会话、限流、审计、数据都在单个 SQLite 文件；不能水平扩展多实例。
- IP 限流为进程内存；重启会清空。认证接口另有 Nginx 限流与账号锁定。
- 若要公网/多实例：迁移 PostgreSQL、Redis 会话与限流、对象存储/CDN 视频，并补充队列与集中日志。详见生产化路线图。