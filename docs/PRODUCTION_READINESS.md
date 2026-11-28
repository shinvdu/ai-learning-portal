# 生产就绪度（v2.1.0）

> 本文评估 AI Learning Portal v2 从“演示 / 受控试点”走向“生产可用”的状态、遗留风险与完成定义。
>
> **当前结论**：v2.1.0 的 P0 与 P1 核心项已实现并进入待发布验证，目标形态是**单节点或多实例受控生产基线**（PostgreSQL + Redis + Nginx + 备份）。OpenAPI/Scalar、CSV 快照与恢复、SMTP、local/S3 媒体与上传 UI（MinIO 基线已实机验收）、章节独立视频、SQLite 导入器均已可用；Playwright 全量矩阵与若干组织级控制仍未完成，**不应在未完成数据导入演练与合规评审的情况下直接作为公网 SaaS**。

- 架构与验收基线：[ARCHITECTURE_V2.md](ARCHITECTURE_V2.md)
- 选型与取舍：[DECISIONS.md](DECISIONS.md)
- 部署步骤：[DEPLOYMENT.md](DEPLOYMENT.md)
- 演示与 golden 校验：[DEMO_GUIDE.md](DEMO_GUIDE.md)

## 1. P0：已完成

### 1.1 平台与数据

- [x] Express 5 + TypeScript API，`createApp(deps)` 工厂，统一错误 envelope。
- [x] PostgreSQL 16 + Drizzle，迁移 `0001_initial.sql` + `0002_chapter_video.sql`，advisory lock 防并发迁移。
- [x] `records.course_id` 外键 + `records_with_course_name` 视图；课程改名不改历史记录。
- [x] 课程与章节均使用显式视频枚举 `inherit/custom/none`，消除 NULL 与 `"null"` 歧义；`0002` 为 `chapters` 增加 `video_mode`/`video` 与 CHECK 约束。
- [x] 幂等 seed：课程/章节/知识/示例记录；`course_seq` 单调、删课重启不复活。
- [x] 五门课程、30 章、177 条记录的 golden 数据；24 / 5 / 58 / 74.3% / 86.4 / 165.3。

### 1.2 认证与安全

- [x] 注册、登录、退出、邮箱验证、忘记/重置密码；一次性令牌**强制校验过期**。
- [x] Argon2id（`@node-rs/argon2`）；旧 scrypt 哈希登录后透明升级。
- [x] PostgreSQL 会话（仅存 SHA-256），7 天过期，启动时清理过期会话。
- [x] TOTP MFA + 8 枚一次性恢复码；MFA secret 以 AES-256-GCM 加密（`MFA_ENC_KEY`）。
- [x] 按账号锁定（5 次失败 / 15 分钟）、管理员解锁；最后活跃管理员保护。
- [x] CSRF 双提交 + 同源校验；Redis 固定窗口限流（多实例共享，故障降级）。
- [x] 只追加审计：认证、用户、课程/章节、记录 CRUD、CSV 导入导出、数据重置。
- [x] 生产模式启动校验：必需密钥、非 console 邮件、`SERVE_WEB=0`、`TRUST_PROXY=1`。
- [x] 安全响应头（helmet 基线），Nginx 层 HSTS/CSP/COOP/CORP。

### 1.3 API 与管理

- [x] 规范 `/api/v1` + 兼容 `/api` 别名（`Deprecation` / `Link`）。
- [x] 公开目录、课程、章节、知识、看板、洞察、视频 Range（206）。
- [x] 管理用户/课程/章节、视频三态、强制删除课程事务。
- [x] 学习记录 CRUD、分页、CSV 导入（dry-run）/导出（BOM+CRLF）、恢复示例数据。
- [x] 审计查询 API 与管理员 UI。

### 1.4 Web

- [x] Vue 3 + Vite + history 路由，旧 hash 深链重定向。
- [x] 五个公共模块 + 登录/注册/验证/重置/账户/MFA/管理后台/数据演示面板。
- [x] 响应式与 390px 紧凑图表；API 客户端与 CSRF 处理；Pinia 认证状态。

### 1.5 交付与运维

- [x] API/Web Dockerfile（API 非 root、Debian slim 兼容 Argon2；Web 为 nginx:1.27-alpine）。
- [x] `compose.yml`（开发）与 `deploy/compose.prod.yml`（生产，不发布 PG/Redis 端口、独立卷）。
- [x] `migrate` / `seed` 一次性任务按序执行；健康检查与依赖门控。
- [x] Nginx 边缘示例：TLS/HSTS/SPA fallback/immutable 静态/边缘限流/内网健康检查。
- [x] `pg_dump -Fc` 备份 + `pg_restore --clean --if-exists` 恢复 + 行数校验 + 14 天保留。
- [x] pino JSON 日志、`X-Request-Id`、慢请求告警、敏感字段脱敏。
- [x] `/healthz`（存活）与 `/readyz`（PG/Redis/迁移）。
- [x] CI：quality（typecheck/lint/build）、test（PG/Redis + Vitest）、e2e（Playwright 冒烟）。
- [x] 优雅退出：SIGTERM/SIGINT 停止接收、10 秒排空、关闭 pool/Redis。

## 2. P1：待发布（v2.1.0）

P1 核心项已实现，进入 `v2.1.0` 最终验证（变更见 [CHANGELOG.md](../CHANGELOG.md) `[2.1.0]`）；以下为状态与仍需注意的运维限制。

| 项 | 状态 | 影响 / 触发条件 |
|---|---|---|
| OpenAPI 规范 + Scalar（F036） | 已实现：`/api/v1/openapi.json` 始终可读，`/api/v1/docs` 生产需 `ENABLE_API_DOCS=1` | 见 [API.md](API.md) §13 |
| CSV 数据集快照与恢复（F064） | 已实现：导入/重置前自动快照，`/admin/dataset/snapshots`、`/admin/dataset/restore/:id`，管理后台“数据快照”标签 | 误导入可从快照恢复；超大库仍建议物理备份 |
| 内置 SMTP 传输 | 已实现：`MAIL_TRANSPORT=smtp` + `SMTP_URL`（nodemailer） | 仍无重试队列/退信处理 |
| MinIO/S3 媒体（F094） | 已实现：`STORAGE_DRIVER=local|s3`，`/api/v1/media/:key` 支持 Range/预签名；MinIO RELEASE.2024-12-18 实机验证（预签名 PUT/GET、Range 206、课程视频引用） | 媒体对象不在 `pg_dump` 中，需单独备份（见 [DEPLOYMENT.md](DEPLOYMENT.md) §13） |
| 管理端媒体上传 UI（F095） | 已实现：课程/章节表单上传视频与封面，local 直传/S3 预签名，进度+预览，持久化稳定 `path` | 浏览器直传需对象存储 CORS（`MINIO_API_CORS_ALLOW_ORIGIN` / 桶策略）；Nginx 需允许 64m 上传体 |
| 章节独立视频（F096） | 已实现：`chapters.video_mode/video` + 公开按三态解析，管理端继承/自定义/关闭 | 依赖迁移 `0002_chapter_video.sql`；升级必须 `npm run db:migrate` |
| SQLite → PostgreSQL 导入器（F100） | 已实现：`npm run import:sqlite`，支持 `--dry-run`/`--wipe`/`--include-sessions`；v1 fixture 与临时库导入验收通过 | **有 v1 真实数据时，上生产前必须先完成并核对 golden** |
| Playwright 全量矩阵/覆盖率门禁 | CI 仅冒烟 | 回归保障依赖手工验收与截图 |
| WAL/PITR | 未实现 | RPO = 最近一次 `pg_dump` |
| 审计归档/保留/WORM | 未实现 | 合规场景需外部归档 |
| Metrics/Tracing/APM | 未实现 | 仅结构化日志；无指标 dashboards |
| 强制管理员 MFA | 支持但不强制 | 需运维策略或后续功能 |
| SSO/OIDC/SAML、SCIM、多租户、资源级权限 | 不在 v2 范围 | 企业集成需另立项 |
| CSP nonce（移除 `style-src 'unsafe-inline'`） | 未实现 | 现有 CSP 已禁 inline script |

## 3. 遗留风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 邮件网关单点 | 注册/重置失败 | 网关多副本、监控、失败审计 `auth.verification_mail_failed`；v2.1.0 提供 SMTP 备用传输（§2） |
| Redis 故障 | 限流降级、`/readyz` 503 | 进程内回退保证可用；监控 readiness；生产部署 Redis 持久化 |
| `MFA_ENC_KEY` 轮换 | 现有 MFA 失效 | 轮换需配合批量 `resetMfa`；流程见 [DEPLOYMENT.md](DEPLOYMENT.md) §11 |
| 迁移无自动回滚 | 失败升级 | 升级前 `backup.sh`；回滚用备份或旧 tag |
| 单区域单库 | 故障中断 | 定期备份异地存放；资源级监控；必要时只读副本（未实现） |
| 媒体未纳入 `pg_dump` | 仅恢复数据库后媒体丢失/失效 | `MEDIA_DIR` 文件备份或 S3 桶版本化；恢复流程同时恢复媒体（[DEPLOYMENT.md](DEPLOYMENT.md) §13） |
| 对象存储 CORS 配置缺失 | 浏览器预签名直传失败 | 开发用 `MINIO_API_CORS_ALLOW_ORIGIN`，生产在 MinIO/S3 桶侧配置站点源；上传经 API 代理可规避 |
| 章节视频迁移未执行 | `/readyz` 503、章节查询缺列 | 升级流程把 `npm run db:migrate`（`0002`）纳入发布清单；compose `migrate` 先于 API |
| 会话表增长 | 查询变慢 | 启动清理过期会话 + `expires_at` 索引；需周期性 purge |
| 演示数据混入生产 | 指标失真 | 真实部署去掉 `--demo-records`，`SEED_DEMO_RECORDS=0`、`ALLOW_DEMO_RESET=0` |
| 公开注册 | 滥用 | 生产需邮箱验证；可在边缘封禁 `/api/v1/auth/register` 并改用管理员建号 |
| 无 SSO / 多租户 | 企业落地受限 | 明确不在 v2 范围，需求另评估 |
| 审计可被管理员读取但不可改 | 应用层只追加；数据库超级用户仍可改 | 生产收窄 DB 权限、外部归档/告警 |

## 4. 完成定义（DoD）

v2.1.0 发布前必须全部满足：

1. `npm ci && npm run typecheck && npm run lint && npm run build && npm test && npm run test:e2e` 全绿。
2. 生产 compose `build` + `up -d` 成功；`migrate`（含 `0002_chapter_video`）/`seed` 先于 API；`/healthz`、`/readyz` 返回 200。
3. 生产 compose 不发布 PostgreSQL/Redis 主机端口；卷名与开发 compose 不同。
4. 备份脚本生成可 `pg_restore --list` 的 dump；恢复演练后 golden 值一致（24/5/58/74.3/86.4/165.3）。
5. 安全冒烟：匿名 401、学习者 403、CSRF 403、未知 API 404、2MB JSON 413、媒体超限 413、视频 Range 206、MFA 全流程；管理员上传（local/S3）与章节视频三态各走一遍。
6. 文档命令逐条可执行；内部链接与路径存在；无硬编码密钥或真实凭据。
7. 发布清单与回滚步骤见 [RELEASE_NOTES_v2.1.0.md](RELEASE_NOTES_v2.1.0.md)。

未满足以上任一项时，不合并 `next` → `main`、不打 `v2.1.0` 标签。

## 5. 上线前组织级检查（非代码）

- [ ] 数据合规：确认只使用模拟数据；真实学生数据需隐私政策、保留/删除策略与 DPA。
- [ ] 内容版权：课程讲义与视频的授权范围。
- [ ] 运维值班与告警接收人；日志/审计保留周期。
- [ ] 域名、TLS 证书与 `PUBLIC_BASE_URL` 一致；邮件发件域 SPF/DKIM/DMARC。
- [ ] 密钥管理：`ADMIN_PASSWORD`、`MFA_ENC_KEY`、`MAIL_WEBHOOK_TOKEN`、`POSTGRES_PASSWORD` 进入 Secret Manager 而非 shell 历史。
- [ ] 渗透测试或至少一次外部安全评审。