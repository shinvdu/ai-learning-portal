# API 参考（v2.0.0）

本文描述 AI Learning Portal v2 的 HTTP API。规范前缀为 **`/api/v1`**；旧前缀 **`/api`** 复用同一套 router，并在响应中追加：

```
Deprecation: true
Link: </api/v1/...>; rel="successor-version"
```

旧别名不会复制处理器，行为与 `/api/v1` 完全一致。所有响应均为 JSON（CSV 导出除外），字符集 UTF-8。

- 健康检查位于根路径 `/healthz`、`/readyz`，不在 `/api` 下。
- 未知 API 路径统一返回 `404 {"error":"接口不存在"}`。
- 请求体上限 **2 MB**，超出返回 `413 {"error":"请求体超过 2MB 限制"}`。

---

## 1. 会话与 Cookie

| Cookie | 属性 | 用途 |
|---|---|---|
| `aip_session` | `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`（HTTPS 时加 `Secure`） | 会话 token；数据库只存 SHA-256，7 天绝对过期 |
| `aip_csrf` | 可读；`SameSite=Lax; Path=/; Max-Age=604800` | CSRF 双提交 token |

- 非 API 路径不查询会话；只有 `/api` 请求才解析 `aip_session`。
- 登录/注册成功通过 `Set-Cookie` 下发 `aip_session`；退出时以相同属性清除。
- 管理员首次启动由 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 引导创建；生产环境密码必填，开发环境缺省时随机生成（不会写入日志）。

## 2. CSRF 与同源校验

写方法（`POST` / `PUT` / `PATCH` / `DELETE`）必须满足：

1. **同源**：请求带 `Origin` 时，必须与 `Host` / `PUBLIC_BASE_URL` 同源，否则 `403 {"error":"跨站请求被拒绝"}`。
2. **双提交**：请求带 `Origin` 时，`X-CSRF-Token` 头必须与 `aip_csrf` Cookie 的长度和内容完全一致，否则 `403 {"error":"CSRF 校验失败，请刷新页面后重试"}`。

无 `Origin` 的客户端（curl、CI、服务间调用）视为非浏览器请求，不做 CSRF 校验。SPA 通过 `GET /api/v1/auth/csrf` 获取 token，或从页面加载时下发的 `aip_csrf` Cookie 读取。

## 3. 错误封装

统一结构：

```json
{ "error": "错误文案", "errors": ["字段错误 1"], "code": "MAIL_FAILED" }
```

- `error` 必填；`errors` 仅在有多条校验错误时出现；`code` 仅用于特殊场景（如 `EMAIL_UNVERIFIED`、`MAIL_FAILED`）。
- 学习记录写入类接口沿用 v1 形状：失败返回 `{ "ok": false, "errors": [...] }`，成功返回 `{ "ok": true, ... }`。

| 状态码 | 典型场景 |
|---|---|
| 400 | 参数校验失败、CSV 内容缺失、空 PATCH |
| 401 | 未登录、邮箱或密码错误、验证码错误 |
| 403 | 非管理员、CSRF/同源失败、未验证邮箱、生产禁用演示重置 |
| 404 | 未知 API、课程/章节/用户/记录不存在 |
| 409 | 唯一约束冲突、MFA 已启用、课程仍有记录（未 `force`） |
| 413 | 请求体超过 2 MB |
| 423 | 账号临时锁定（15 分钟） |
| 429 | 触发限流 |
| 502 | 邮件网关失败（`code: "MAIL_FAILED"`） |
| 503 | `/readyz` 依赖不可用 |

## 4. 分页

管理端列表使用 offset 分页，响应形状：

```json
{
  "total": 177,
  "limit": 20,
  "offset": 0,
  "rows": [ { "...": "..." } ]
}
```

| 列表 | `limit` 范围 | 默认 | `offset` |
|---|---|---|---|
| 学习记录 | 1–200 | 20 | ≥ 0 |
| 审计日志 | 1–200 | 50 | ≥ 0 |

非法或空值回退到默认值而不是报错；`limit=0` 视为未提供。

## 5. 限流

Redis 固定窗口，键形如 `rl:<scope>:<ip|userId>`；成功登录/注册/MFA 会清除对应桶。Redis 不可用时降级为进程内计数，`/readyz` 同时降级为 503。

| 范围 | 端点 | 额度 |
|---|---|---|
| 每 IP | `register` / `login` / `mfa` / `verify-email` / `resend-verification` / `forgot-password` / `reset-password` | 20 次 / 10 分钟 |
| 每用户 | `change-password` / `mfa/enable` / `mfa/disable` | 10 次 / 10 分钟 |

超出返回 `429 {"error":"尝试次数过多，请稍后再试"}`。

---

## 6. 认证端点

基址：`/api/v1/auth`

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/me` | 可选 | 当前会话用户，未登录为 `{"user":null}` |
| GET | `/csrf` | 公开 | 返回/下发 `aip_csrf` token，`Cache-Control: no-store` |
| POST | `/register` | 公开 | 注册；生产环境需邮箱验证，开发环境直接建会话 |
| POST | `/login` | 公开 | 登录；启用 MFA 时返回 5 分钟 challenge |
| POST | `/mfa` | 公开 | 用 `challengeToken` + TOTP/恢复码完成登录 |
| POST | `/verify-email` | 公开 | 兑换邮箱验证 token |
| POST | `/resend-verification` | 公开 | 重发验证邮件（防枚举，统一返回成功文案） |
| POST | `/forgot-password` | 公开 | 发送重置邮件（防枚举） |
| POST | `/reset-password` | 公开 | 用一次性 token 设置新密码，撤销旧会话 |
| POST | `/change-password` | 会话 | 修改当前用户密码 |
| POST | `/mfa/setup` | 会话 | 生成 TOTP 密钥与 `otpauth://` URI（暂存，加密存储） |
| POST | `/mfa/enable` | 会话 | 校验 6 位码，启用 MFA 并返回 8 枚恢复码 |
| POST | `/mfa/disable` | 会话 | 用密码关闭 MFA |
| POST | `/logout` | 公开 | 撤销当前会话并清除 Cookie |

请求体：

```json
POST /api/v1/auth/register   { "name": "张三", "email": "user@example.com", "password": "至少8位" }
POST /api/v1/auth/login      { "email": "user@example.com", "password": "..." }
POST /api/v1/auth/mfa        { "challengeToken": "...", "code": "123456" }
POST /api/v1/auth/verify-email { "token": "..." }
POST /api/v1/auth/resend-verification { "email": "user@example.com" }
POST /api/v1/auth/forgot-password      { "email": "user@example.com" }
POST /api/v1/auth/reset-password       { "token": "...", "password": "至少8位" }
POST /api/v1/auth/change-password      { "currentPassword": "...", "newPassword": "至少8位" }
POST /api/v1/auth/mfa/enable  { "code": "123456" }
POST /api/v1/auth/mfa/disable { "password": "..." }
```

响应示例：

```json
// 201 注册（生产：等待验证）
{ "verificationRequired": true, "email": "user@example.com" }

// 201 注册 / 200 登录成功
{ "user": { "id": 7, "name": "张三", "email": "user@example.com", "role": "learner", "email_verified": true } }

// 200 登录但需要 MFA
{ "mfaRequired": true, "challengeToken": "..." }

// 200 MFA setup
{ "secret": "BASE32SECRET", "otpauthUri": "otpauth://totp/...", "message": "在认证器中添加该密钥，然后输入 6 位验证码完成启用" }

// 200 MFA enable
{ "recoveryCodes": ["AAAA-BBBB", "..."] }
```

- 未验证邮箱登录返回 `403 {"error":"请先验证邮箱后再登录","code":"EMAIL_UNVERIFIED"}`。
- 连续 5 次密码/MFA 失败后账号锁定 15 分钟，返回 `423`。
- 密码规则：8–200 字符；姓名 1–60 字符。

## 7. 公开目录与内容端点

基址：`/api/v1`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/meta` | 站点概览、数据集元信息、课程引用（id/name/category） |
| GET | `/courses?q=&category=` | 课程列表（含每课统计）、全部分类、站点概览 |
| GET | `/courses/:idOrName` | 课程详情、课程统计、推断的章节到达率 |
| GET | `/chapters/:courseId/:idx` | 章节、课程、视频、章节统计、相关测验、上/下一章 |
| GET | `/knowledge/:id` | 课程知识中心文档；无文档时 `knowledge: null` |
| GET | `/dashboard?course=` | 学习看板数据（KPI、图表分组、洞察、数据质量） |
| GET | `/insights` | 数据洞察（含公式、常见误区、分课程统计） |
| GET | `/media/:key` | 读取课程媒体。本地驱动直接流式返回并支持单区间 `Range`（`200`/`206`/`416`）；S3 驱动返回 `302` 到短时有效的预签名 GET。`key` 必须匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,128}`（无路径穿越） |

- `q` 同时匹配课程名、简介、讲师、分类；`category` 为精确匹配；课程概览不受筛选影响。
- `dashboard?course=` 为精确课程名；未知课程回退为全站数据，`filter` 返回 `null`。
- 章节 `idx` 必须为非负十进制整数；非数字返回 `接口不存在`，课程不存在返回 `课程不存在`，索引不存在返回 `章节不存在`。
- 公开端点只返回聚合结果，不暴露原始记录、`video_mode` / `video_json` 内部状态。

示例：

```bash
curl -s 'http://127.0.0.1:8787/api/v1/courses?q=Python'
curl -s 'http://127.0.0.1:8787/api/v1/dashboard?course=Python%20%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90'
curl -s 'http://127.0.0.1:8787/api/v1/chapters/C3/4'
```

## 8. 管理端点

除特别说明外，全部需要 **管理员** 会话；匿名返回 401，学习者返回 `403 {"error":"需要管理员权限"}`。

### 用户

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/users` | 用户列表（安全字段，无密码哈希/MFA secret） |
| POST | `/admin/users` | 创建用户：`{name,email,password,role?,active?}`，默认 `learner`、已验证 |
| PATCH | `/admin/users/:id` | 更新 `name/role/active/password/unlock/emailVerified/resetMfa` |

保护规则：最后一个活跃管理员不能被降级或停用；管理员不能降级/停用自己；停用用户撤销其全部会话；改密码撤销目标用户会话（管理员改自己密码时保留当前会话）。

### 课程与章节

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/courses` | 课程列表（含统计与章节正文） |
| POST | `/admin/courses` | 新建课程；id 来自 `course_seq`（种子后从 `C6` 开始） |
| PATCH | `/admin/courses/:id` | 更新元数据与视频三态（`inherit/custom/none`） |
| DELETE | `/admin/courses/:id` | 有记录时返回 `409 {conflict,records}`；`?force=1` 事务内删除记录→章节→知识→课程 |
| POST | `/admin/courses/:courseId/chapters` | 追加章节（`MAX(idx)+1`， advisory lock 串行） |
| PATCH | `/admin/courses/:courseId/chapters/:idx` | 修改标题/正文 |
| DELETE | `/admin/courses/:courseId/chapters/:idx` | 删除指定章节，保留编号空洞 |

课程改名不会改写历史记录（`records.course_id` 外键，展示时 join 当前课程名）。

### 学习记录与 CSV

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/records?course=&student=&q=&limit=&offset=` | 分页记录，固定顺序 `learning_date DESC, student_id, id` |
| POST | `/records` | 新增记录 |
| PATCH | `/records/:id` | 部分更新；空 body 返回 `400 {"error":"没有需要更新的字段"}` |
| DELETE | `/records/:id` | 删除记录 |
| POST | `/records/import` | CSV 导入；JSON `{csv}` 或 `text/csv`；`?dry_run=1` 只校验；导入前自动写快照 |
| GET | `/export.csv` | 导出 UTF-8 BOM + CRLF 的 `learning_records.csv` |
| POST | `/admin/reset` | 恢复打包示例数据；生产需 `ALLOW_DEMO_RESET=1`；重置前自动写快照 |

记录字段：`student_id`、`course_name`（导入/展示，内部映射为 `course_id`）、`learning_date`（`YYYY-MM-DD`）、`learning_minutes`、`chapters_done`、`total_chapters`、`quiz_score`（可为 `null`）。

### 数据集快照

破坏性导入（CSV 导入）与“恢复示例数据”在写入前都会生成快照，可用于回滚误操作。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/dataset/snapshots` | 列出快照（最新在前），字段含 `id`、`reason`、`row_count`、`created_at`；`reason` 为 `csv-import` / `seed-reset` / `pre-restore` |
| POST | `/admin/dataset/restore/:id` | 恢复到指定快照。响应含 `restored`、`snapshot`、`preRestoreSnapshot`、`dataset`。恢复前会先把当前行保存为 `pre-restore` 快照，因此恢复本身也可再次回滚；未知课程返回 `409`，非法行返回 `400`，快照不存在返回 `404` |

快照与恢复均写审计：`data.snapshot_created`、`data.snapshot_restored`（`data.csv_imported` / `data.reset` 保持原动作名不变）。

### 媒体

`STORAGE_DRIVER=local`（默认）时，文件落在 `MEDIA_DIR`，通过 API 提供 Range 播放；`STORAGE_DRIVER=s3` 时对接 S3/MinIO，凭据只留在服务端。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/admin/media/presign` | 请求体 `{filename, contentType}` → `{key, uploadUrl, publicUrl, expiresIn}`（`expiresIn` 为 900 秒）。S3 返回预签名 PUT；本地返回 `/admin/media/upload?key=...` 上传地址 |
| POST | `/admin/media/upload?key=&filename=` | 仅本地驱动；原始字节流（`application/octet-stream` 或视频/MIME），受 `MEDIA_MAX_BYTES` 限制，超限 `413`；返回 `201 {key, url}`。S3 模式返回 `400`，应改用 presign |

把课程视频指向媒体对象：在上传得到 `key` 后，用管理后台课程表单把视频模式设为 `custom`，`src` 填站内路径 `/api/v1/media/<key>`（封面同理填 `/api/v1/media/<posterKey>`；`src`/`poster` 必须以 `/` 开头，不接受外站或协议相对地址）。

```bash
# 本地驱动：上传 mp4（管理员会话，带 CSRF/Origin，同浏览器行为）
curl -b jar.txt -H "X-CSRF-Token: $(awk '$6=="aip_csrf"{print $7}' jar.txt)" \
  -H 'Origin: http://127.0.0.1:8787' \
  -H 'Content-Type: video/mp4' --data-binary @sample.mp4 \
  'http://127.0.0.1:8787/api/v1/admin/media/upload?filename=sample.mp4'
# → 201 {"key":"<hex>.mp4","url":"http://.../api/v1/media/<hex>.mp4"}
curl -r 0-99 -i 'http://127.0.0.1:8787/api/v1/media/<hex>.mp4'   # → 206 Partial Content
```

### 审计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/audit?action=&limit=&offset=` | 按 `id DESC` 分页；`action` 精确过滤；`details` 为 JSON 对象 |

所有管理写操作都会追加审计记录（只追加）。

## 9. 审计动作

| 分组 | 动作 |
|---|---|
| 认证 | `auth.register`、`auth.login`、`auth.login_failed`、`auth.login_inactive`、`auth.login_locked`、`auth.mfa_challenge`、`auth.login_mfa`、`auth.mfa_failed`、`auth.email_verified`、`auth.verification_resent`、`auth.verification_mail_failed`、`auth.password_reset_requested`、`auth.password_reset`、`auth.password_changed`、`auth.mfa_setup_started`、`auth.mfa_enabled`、`auth.mfa_disabled`、`auth.logout` |
| 用户 | `admin.user_created`、`admin.user_updated` |
| 课程/章节 | `admin.course_created`、`admin.course_updated`、`admin.course_deleted`、`admin.chapter_created`、`admin.chapter_updated`、`admin.chapter_deleted` |
| 数据 | `data.record_created`、`data.record_updated`、`data.record_deleted`、`data.csv_imported`、`data.csv_exported`、`data.csv_reset`、`data.reset`、`data.snapshot_created`、`data.snapshot_restored` |

## 10. 健康检查

| 方法 | 路径 | 响应 |
|---|---|---|
| GET | `/healthz` | `200 {"ok":true,"uptime":123.4}`（仅进程存活） |
| GET | `/readyz` | `200 {"ok":true}` 或 `503 {"ok":false}`；检查 PostgreSQL `select 1`、Redis `PING`、Drizzle 迁移 journal 是否已应用 |

健康检查在生产只应允许内网/回环访问；示例见 `deploy/nginx/portal.conf.example`。日志中 `/healthz`、`/readyz` 不产生访问日志。

## 11. 请求追踪与日志

- 每个响应带 `X-Request-Id`：合法入站值直接复用，否则生成 UUID。
- pino JSON 日志字段含 `requestId`、`method`、`path`、`status`、`duration`、`userId`；超过 500 ms 的请求记录警告。
- Cookie、`Authorization`、密码、token、验证码在日志中脱敏。
- `LOG_LEVEL` 控制级别（`fatal/error/warn/info/debug/trace`）。

## 12. 客户端示例

```bash
# 1) 获取 CSRF（同时下发 aip_csrf）
curl -c jar.txt http://127.0.0.1:8787/api/v1/auth/csrf

# 2) 登录（浏览器场景需带 X-CSRF-Token；curl 无 Origin 可省略）
curl -b jar.txt -c jar.txt -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me-before-use"}' \
  http://127.0.0.1:8787/api/v1/auth/login

# 3) 查看当前用户
curl -b jar.txt http://127.0.0.1:8787/api/v1/auth/me

# 4) 登录后写操作
curl -b jar.txt -c jar.txt \
  -H 'Origin: http://127.0.0.1:8787' \
  -H "X-CSRF-Token: $(awk '$6=="aip_csrf"{print $7}' jar.txt)" \
  -H 'Content-Type: application/json' \
  -d '{"student_id":"S90","course_name":"Python 数据分析","learning_date":"2026-11-17","learning_minutes":60,"chapters_done":8,"total_chapters":8,"quiz_score":92}' \
  http://127.0.0.1:8787/api/v1/records
```

## 13. OpenAPI 与交互式文档

文档端点与 `/api/v1` 同挂载，因此也可经旧 `/api` 前缀访问：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/openapi.json` | OpenAPI 3.1 规范，`application/json` + `Cache-Control: no-store`，**始终可读** |
| GET | `/docs` | Scalar 交互式文档；`APP_ENV !== 'production'` 或 `ENABLE_API_DOCS=1` 时返回 HTML，否则 `404 {"error":"接口不存在"}` |

- 规范由 `packages/contracts` 用与运行时校验相同的 zod schema 生成，覆盖 41 条路径（认证、公开目录、分析、管理、媒体、数据快照、健康检查），并声明 cookie 会话、`X-CSRF-Token` 与错误 envelope。
- `GET /api/v1/openapi.json` 始终可读（`no-store`）；`GET /api/v1/docs` 是 Scalar UI，网络侧从 jsDelivr 加载前端资源，该页单独放宽 CSP，其余页面保持严格策略。
- 生产默认关闭 `/docs`；如需开放，设置 `ENABLE_API_DOCS=1`。开发/测试环境默认开放，无需设置。

```bash
curl -s http://127.0.0.1:8787/api/v1/openapi.json | jq '.openapi, (.paths | keys | length)'
# → "3.1.0" \n 41
```

导入 Scalar/Postman：直接以 `http://127.0.0.1:8787/api/v1/openapi.json` 作为规范地址即可。