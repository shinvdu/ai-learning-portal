# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

P1 增强已在 `next` 分支实现，**尚未发布**；`v2.0.0` 仍是最新发布版本。

### Added

- **OpenAPI 规范与 Scalar 文档（F036）**：`GET /api/v1/openapi.json` 返回由 zod 契约生成的 OpenAPI 3.1 规范（41 条路径，含媒体与数据快照）；`GET /api/v1/docs` 提供 Scalar 交互式文档。开发/测试默认开放，生产需显式 `ENABLE_API_DOCS=1`。旧 `/api` 别名同样可访问。
- **CSV 数据集快照与恢复（F064）**：CSV 导入与“恢复示例数据”前自动写入 `record_snapshots`；管理后台新增“数据快照”标签页；`GET /api/v1/admin/dataset/snapshots` 列出快照，`POST /api/v1/admin/dataset/restore/:id` 恢复某个快照。恢复前会先把当前行保存为 `pre-restore` 快照，因此恢复本身也可再次回滚。
- **SMTP 邮件传输（F049 扩展）**：`MAIL_TRANSPORT=smtp` + `SMTP_URL`（`smtp://` 或 `smtps://` 隐式 TLS），通过 nodemailer 发送；`SMTP_URL` 缺失时启动失败，不会静默降级。
- **媒体存储 local / S3（F094）**：`STORAGE_DRIVER=local|s3`。本地驱动使用 `MEDIA_DIR` 与 `MEDIA_MAX_BYTES`；S3 驱动使用 `S3_*`（MinIO/AWS）。新增公开读取 `GET /api/v1/media/:key`（本地 Range 200/206/416，S3 返回 302 预签名跳转）、`POST /api/v1/admin/media/presign`、`POST /api/v1/admin/media/upload`。开发 compose 新增 `media` profile 运行 MinIO（主机 9000/9001）。
- **SQLite → PostgreSQL 导入器（F100）**：`npm run import:sqlite` / `scripts/import-sqlite.sh`，支持 `--dry-run`（只校验、不写库）、`--wipe`（先清空导入器负责的表）、`--include-sessions`；只读打开 v1 `data/portal.db`，在单个 PostgreSQL 事务中写入已迁移的目标库。

### Changed

- `ENABLE_API_DOCS` 现在实际控制生产环境的 `/api/v1/docs`（此前为预留开关）；`/api/v1/openapi.json` 始终可读。
- 生产配置校验新增：`MAIL_TRANSPORT=smtp` 需要 `SMTP_URL`；`STORAGE_DRIVER=s3` 需要 `S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`。
- 审计新增动作 `data.snapshot_created`、`data.snapshot_restored`（只追加语义不变）。

## [2.0.0] - 2026-11-28

产品级重写。`v1.2.0` 标签继续保留为零依赖、SQLite 的离线教学版，可按 tag 检出运行。

### Breaking changes

- **运行时栈整体替换**：由零依赖 `node:http` + `node:sqlite` + 原生前端，改为 **Express 5 + TypeScript + Vue 3 + Vite + PostgreSQL 16 + Redis 7**。
- 运行 v2 需要 Node.js ≥ 24、PostgreSQL 16、Redis 7 与构建步骤（`npm ci && npm run build`）；不再支持直接 `npm start`。
- API 规范前缀改为 `/api/v1`；旧 `/api` 保留薄别名，响应新增 `Deprecation: true` 与 successor `Link` 头。
- 前端由 hash 路由改为 history 路由；旧 `#/...` 链接会自动重定向到新路径。
- 数据存储由 SQLite 文件改为 PostgreSQL；**没有自动的 SQLite → PostgreSQL 迁移**（导入器为 P1，见下文）。
- 学习记录改用 `course_id` 外键 + `records_with_course_name` 视图；课程改名不再级联改写历史记录。
- 视频配置改为显式 `video_mode` 枚举（`inherit` / `custom` / `none`）+ `jsonb`，消除 v1 的 NULL 与 `"null"` 双重语义。

### Added

- npm workspaces 单仓库：`apps/api`、`apps/web`、`packages/{config,contracts,content,db,domain}`，TypeScript project references。
- PostgreSQL + Drizzle SQL 迁移，迁移 runner 使用 `pg_advisory_lock`，`/readyz` 校验迁移 journal。
- Vue 3 SPA：课程广场、课程详情、章节、知识中心、学习看板、数据洞察、登录/注册/验证/重置、账户与 MFA、管理后台、数据演示面板。
- 管理 API：用户、课程/章节、视频三态、记录 CRUD 与分页、CSV 导入（`dry_run`）/导出、审计查询、恢复示例数据。
- 密码重置、邮箱验证、TOTP MFA + 一次性恢复码、账号锁定与管理员解锁、最后活跃管理员保护。
- 只追加审计日志（固定动作名），请求 ID（`X-Request-Id`）、pino JSON 日志、慢请求告警、敏感字段脱敏。
- 健康检查 `/healthz`（存活）与 `/readyz`（PostgreSQL + Redis + 迁移）。
- Docker Compose 开发编排（`compose.yml`，postgres 5433 / redis 6380）与生产编排（`deploy/compose.prod.yml`，不发布 PG/Redis 端口、独立卷）。
- 边缘 Nginx 示例（TLS 1.2/1.3、HSTS、CSP、SPA fallback、immutable 静态、限流、内网健康检查）与 systemd 单元。
- `scripts/backup.sh`（`pg_dump -Fc` + 完整性校验 + 14 天保留）、`scripts/restore.sh`（`--clean --if-exists`，需确认）、`scripts/healthcheck.sh`。
- CI：typecheck/lint/build、Vitest（PG/Redis 服务）、Playwright 冒烟。

### Changed

- 密码哈希由 scrypt 升级为 Argon2id；旧 `scrypt$...` 哈希在登录成功后透明重哈希，用户无需重置。
- 会话由 SQLite 表迁到 PostgreSQL，token 只存 SHA-256；Redis 仅用于限流计数。
- 限流由进程内 Map 改为 Redis 固定窗口（成功登录清除桶）；Redis 故障回退进程内 Map 并降级 readiness。
- 知识中心、章节测验、数据分析口径由 `packages/domain` / `packages/content` 计算，公开页不暴露原始记录。
- 生产模式启动时强制校验 `DATABASE_URL`、`REDIS_URL`、`PUBLIC_BASE_URL`、`MFA_ENC_KEY`、`ADMIN_PASSWORD` 与非 console 邮件传输。

### Security

- 一次性令牌（邮箱验证、密码重置、MFA challenge）**强制校验过期**（修复 v1 可复用过期令牌的问题）。
- 密码使用 Argon2id（`@node-rs/argon2`）。
- TOTP secret 使用 AES-256-GCM 加密后落库（`MFA_ENC_KEY`）；恢复码只存哈希。
- 限流迁移到 Redis，多实例共享计数；Redis 故障不影响登录。
- CSRF 双提交（`aip_csrf` + `X-CSRF-Token`）叠加同源 `Origin` 校验。
- 安全响应头：helmet 基线 + Nginx HSTS/CSP/COOP/CORP/Permissions-Policy；Cookie 为 `HttpOnly` + `SameSite=Lax`，HTTPS 自动 `Secure`。
- 审计日志只追加；密码、会话 token、验证/重置 token 不写入日志。

### Migration and seed notes

- 全新数据库：`npm run db:migrate` → `npm run seed`（开发默认导入 177 条示例记录）；生产 compose 的 `seed` 使用 `--demo-records`。
- 生产环境默认 `SEED_DEMO_RECORDS=0`、`ALLOW_DEMO_RESET=0`；演示需显式开启。
- `seed --reset` 会删除 records → chapters → knowledge → courses 后重建；生产还需 `ALLOW_DEMO_RESET=1`。
- `course_seq` 与课程高水位对齐，删除最新课程后新建仍单调递增。
- 从 v1.2.0 升级：**先完成 SQLite → PostgreSQL 导入**（P1，尚未提供）；当前示例站可直接重新 seed，不要在有真实数据的库上执行 seed。

### Known limitations

- OpenAPI/Scalar、CSV 快照与撤销、SMTP、MinIO/S3、SQLite 导入器、Playwright 全量矩阵均为 P1（详见 [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md)）。
- 无 SSO/OIDC/SAML、SCIM、多租户、资源级权限；无 WAL/PITR；无指标/Tracing APM。
- 管理员 MFA 支持但不强制。
- 迁移无自动回滚；回滚依赖备份恢复或检出旧 tag。

## [1.2.0] - 2026-11-28

### Added

- Production email verification with one-time tokens and a `MAIL_WEBHOOK_URL` email adapter.
- Forgot-password / reset-password flow; reset revokes all sessions and verifies mailbox control.
- TOTP MFA with one-time recovery codes, self-service account page, and admin MFA reset.
- Per-account lockout after five failed password/MFA attempts, with admin unlock.
- Audit log and admin viewer for authentication, users, courses/chapters, records, CSV import/export, and reset.
- CSRF double-submit cookie and `X-CSRF-Token` validation alongside the existing origin check.
- Versioned SQLite migrations (`schema_migrations`).
- `npm run backup` using `VACUUM INTO`, plus restore/deployment documentation.
- Production mode (`APP_ENV=production`) with demo-record suppression, mandatory mail/admin configuration, and no generated-password logging.
- Health endpoints (`/healthz`, `/readyz`), Nginx and systemd examples.
- `npm run admin:reset` for locked-out administrator recovery.

### Security

- MFA enable revokes other password-only sessions.
- Stricter CSP (`object-src`, `frame-src`, `worker-src`), COOP/CORP and Permissions-Policy headers.
- Significantly expanded SECURITY.md and production readiness documentation.

## [1.1.1] - 2026-11-28

### Fixed

- Password resets now revoke all of the target user's other sessions; an admin changing their own password keeps the current session.
- Removing a course video in the admin UI now actually removes it on the public course page (previously it fell back to the seed video).
- Seed flags for catalog and chapters prevent intentionally deleted courses/chapters from being recreated on restart.
- CSV/API date validation rejects impossible calendar dates such as `2026-02-31`.
- Admin media URLs are restricted to same-origin paths (no `javascript:`, protocol-relative, or traversal URLs).
- Course IDs are monotonic (deleting the newest course no longer reuses its ID), and course ordering uses numeric IDs.
- New courses default to the end of the catalog instead of sharing sort order 0.
- Dashboard ignores a stale `?course=` filter after a course is renamed/deleted and reloads the full dataset.
- Malformed request URLs return 400 instead of throwing.
- Login/register rate-limit buckets reset after success.
- Logout clears the session cookie with the same `Secure` attribute as login.
- Bootstrap admin email/password validation is enforced (password ≥ 8 characters).
- Added `npm run admin:reset` for resetting a locked-out administrator and revoking their sessions.

## [1.1.0] - 2026-11-28

### Added

- Email/password registration, login, logout, and `GET /api/auth/me`.
- scrypt password hashing, SQLite-backed sessions, HttpOnly/SameSite cookies, and per-IP rate limiting.
- Admin bootstrap via `ADMIN_EMAIL` / `ADMIN_PASSWORD`, with a generated password fallback.
- User management: create users, change roles, enable/disable accounts, reset passwords.
- Course management: course metadata, color, video, ordering; chapter create/edit/delete.
- Admin-only data playground and record-write APIs.
- Last-active-admin protection and automatic session invalidation on deactivation.

### Changed

- Course, chapter, and knowledge seed data is imported only on first run; the database becomes the source of truth.
- `npm run verify` now uses a temporary database and no longer resets the development database.
- Course chapter titles and video configuration are read from the database with seed fallbacks.

### Security

- Same-origin checks for mutating requests.
- Admin-only authorization on record writes, CSV import/export, and admin endpoints.
- Passwords and session tokens are never returned by the API or written to logs.

## [1.0.0] - 2026-11-25

### Added

- Course catalog, course detail, knowledge center, learning dashboard, and data insights.
- 30 chapter pages built from lecture texts, with a shared sample video, quizzes, and inferred chapter reach rates.
- Editable data playground: record CRUD, CSV import/export, and restore-to-seed.
- Zero-dependency Node.js HTTP server and SQLite data layer using `node:http` and `node:sqlite`.
- Vanilla ES-module frontend with hash routing and hand-written SVG charts.
- Responsive layouts and compact chart mode for narrow screens.
- HTTP Range support for sample video playback.
- Verification script covering metrics, content, chapters, and assets.
- CI workflow, architecture and demo documentation, and sample screenshots.

### Notes

- All student records, course texts, and videos are simulated/placeholder content.
- Chapter reach rates are inferred from total completed chapters and are labelled as such in the UI.