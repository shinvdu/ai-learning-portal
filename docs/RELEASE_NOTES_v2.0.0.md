# Release v2.0.0 — 发布说明与检查清单

- **版本**：2.0.0
- **分支**：`next` → `main`
- **标签**：`v2.0.0`
- **状态**：**清单已准备，但尚未执行**（未合并、未打 tag、未发布、未推送镜像）。
- **兼容基线**：`v1.2.0` 标签保持可用，可随时检出运行零依赖离线版。

> 本文是发布操作单，不代表发布已经发生。所有条目在真正执行前保持未勾选。

## 1. 发布内容

- 产品级重写：Express 5 + TypeScript API、Vue 3 + Vite Web、PostgreSQL 16、Redis 7。
- 认证与安全：Argon2id、PG 会话（SHA-256）、邮箱验证/密码重置（强制过期）、TOTP MFA（secret 加密）、锁定、Redis 限流、CSRF、审计。
- 管理与数据：用户/课程/章节、视频三态、记录 CRUD、CSV 导入导出、恢复示例数据、审计查询。
- 运维：开发/生产 Compose、Nginx 边缘示例、systemd、备份/恢复/健康检查脚本、请求 ID 日志。
- 文档：README（中/英）、ARCHITECTURE_V2、DECISIONS、API、DEPLOYMENT、DEMO_GUIDE、PRODUCTION_READINESS、SECURITY、CONTRIBUTING、CHANGELOG。

破坏性变更与 P1 限制详见 [CHANGELOG.md](../CHANGELOG.md) 的 `2.0.0` 条目。

## 2. 发布前检查清单

### 2.1 构建与静态检查

- [ ] `npm ci` 成功（锁文件与 Node 24 一致）。
- [ ] `npm run typecheck` 通过。
- [ ] `npm run lint` 通过。
- [ ] `npm run build` 通过（API + Web + 全部 packages）。
- [ ] `apps/web/dist/index.html` 与 hashed assets 生成。

### 2.2 测试

- [ ] `npm test` 全绿（API 150 项、领域/契约/内容单测；使用 PG/Redis）。
- [ ] `npm run test:e2e` 全绿（Playwright 冒烟）。
- [ ] golden 值断言通过：24 / 5 / 58 / 177 / 74.3% / 86.4（53 有成绩、5 无成绩）/ 165.3 h。
- [ ] Python 数据分析筛选：17 人 / 55.9%。
- [ ] 安全边界：匿名 401、学习者 403、CSRF 403、未知 API 404、2MB 413、Range 206。

### 2.3 生产 Compose 冒烟

- [ ] `cp deploy/env.example deploy/.env.prod` 并替换全部占位值（含 `POSTGRES_PASSWORD`）。
- [ ] `docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod config` 解析成功。
- [ ] `docker compose -p portalprod -f deploy/compose.prod.yml --env-file deploy/.env.prod build` 成功。
- [ ] `... --env-file deploy/.env.prod up -d` 后 `migrate`、`seed` 完成，`api`、`web` 均为 healthy。
- [ ] `curl -fsS http://127.0.0.1:8080/healthz` 与 `/readyz` 返回 200。
- [ ] `docker compose ... ps` 确认 postgres/redis **未发布**主机端口。
- [ ] 卷名为 `portal_prod_pgdata` / `portal_prod_redisdata`，与开发卷不同。
- [ ] 管理员登录、公开页、管理页、数据演示面板可用。

### 2.4 备份与恢复演练

- [ ] `DATABASE_URL=... ./scripts/backup.sh` 生成可 `pg_restore --list` 的 dump。
- [ ] 在空库/预发库执行 `./scripts/restore.sh <dump>`（确认提示或 `--yes`）。
- [ ] 恢复后行数与 golden 指标一致。
- [ ] 保留策略（默认 14 天）按预期清理。
- [ ] 记录本次演练耗时与 RPO/RTO。

### 2.5 文档与合规

- [ ] 文档命令逐条可执行；路径与文件名与仓库一致。
- [ ] 内部链接检查通过（README、docs、deploy、scripts）。
- [ ] 无硬编码密钥、真实凭据、真实个人信息。
- [ ] 提交/PR/代码注释无助手署名或生成声明。
- [ ] SECURITY.md 报告渠道可用；CHANGELOG 条目完整。

### 2.6 CI（main）

- [ ] `quality`、`test`、`e2e` 在 `main` 全绿。
- [ ] 分支保护与必需检查配置正确。

## 3. 发布步骤（待执行）

```bash
# 1. 确认工作树干净、CI 在 next 上全绿
git status
git log --oneline -5

# 2. 合并 next → main（按仓库策略，可能通过 PR）
git checkout main
git merge --no-ff next
git push origin main

# 3. 打标签并推送
git tag -a v2.0.0 -m "AI Learning Portal v2.0.0"
git push origin v2.0.0

# 4. 发布 GitHub Release（正文引用 CHANGELOG 的 2.0.0 条目）
#    可选：构建并推送带标签的镜像
docker build -f apps/api/Dockerfile -t <registry>/ai-learning-portal-api:2.0.0 .
docker build -f apps/web/Dockerfile -t <registry>/ai-learning-portal-web:2.0.0 .
```

> 以上命令仅为操作草案；在获得明确发布授权前不要执行 push / merge / tag / publish。

## 4. 回滚到 v1.2.0

**回滚应用（保留 v2 数据）**：

```bash
git checkout v1.2.0
npm start        # 零依赖 SQLite；http://127.0.0.1:8787
```

v1.2.0 使用 `data/portal.db`，不会读写 v2 的 PostgreSQL，因此切换不影响 v2 数据。

**回滚 v2 的一次失败升级**：

1. 停止 API。
2. 用升级前 `scripts/backup.sh` 生成的 dump 执行 `scripts/restore.sh`。
3. 检出上一个可用 tag（当前即 `v1.2.0`），按对应版本的部署文档启动。
4. 运行 `scripts/healthcheck.sh` 并核对 golden 值。

**注意**：v2 的 SQL 迁移没有自动 down/rollback；不要把 v1.2.0 指向 v2 的 PostgreSQL。

## 5. 发布后

- [ ] 删除或标记已合并的临时分支。
- [ ] 更新 `docs/RELEASE_NOTES_v2.0.0.md` 状态为“已发布”，记录发布日期与 tag。
- [ ] 在 `main` 上创建 `v2.0.1` 之前的后续工作项（P1 列表见 [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)）。
- [ ] 确认 `v1.2.0` 检出仍可 `npm start` 且离线可用（发布后复核）。