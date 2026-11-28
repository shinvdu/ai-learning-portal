/**
 * OpenAPI 3.1 document builder (F036).
 *
 * The document is generated from the same zod schemas that validate requests
 * and type responses, so it cannot drift from the runtime contract. Paths and
 * operations mirror the real Express route catalog (see `apps/api/src/app.ts`
 * and `apps/api/src/modules/**`); the canonical prefix is `/api/v1`
 * (ADR-010, with the legacy `/api` alias sharing the same handlers).
 *
 * This module is UI-agnostic and has no server/DB dependencies: the API layer
 * (`apps/api/src/lib/openapi.ts`) calls it once at start-up and the Scalar
 * router serves the result from `GET /openapi.json`.
 */
import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import type {
  ZodOpenApiOperationObject,
  ZodOpenApiResponseObject,
  ZodOpenApiResponsesObject,
} from 'zod-openapi';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { ApiErrorSchema, SimpleOkResponseSchema } from './common.js';
import {
  AuthUserResponseSchema,
  ChangePasswordBodySchema,
  ForgotPasswordBodySchema,
  LoginBodySchema,
  LoginResponseSchema,
  MeResponseSchema,
  MessageOkResponseSchema,
  MfaBodySchema,
  MfaChallengeResponseSchema,
  MfaDisableBodySchema,
  MfaEnableBodySchema,
  MfaEnableResponseSchema,
  MfaSetupResponseSchema,
  RegisterBodySchema,
  RegisterResponseSchema,
  ResetPasswordBodySchema,
  ResendVerificationBodySchema,
  VerifyEmailBodySchema,
  VerifyEmailResponseSchema,
} from './auth.js';
import { AuditRowSchema, AuditResponseSchema } from './audit.js';
import {
  AdminCourseSchema,
  AdminCoursesResponseSchema,
  ChapterRowSchema,
  ChapterStatSchema,
  CourseCreateBodySchema,
  CourseDeleteResponseSchema,
  CourseDetailResponseSchema,
  CourseMutationResponseSchema,
  CourseUpdateBodySchema,
  CourseWithStatsSchema,
  CoursesResponseSchema,
  CourseMetaSchema,
  MetaResponseSchema,
} from './courses.js';
import {
  ChapterCourseSchema,
  ChapterCreateBodySchema,
  ChapterDetailSchema,
  ChapterMutationResponseSchema,
  ChapterResponseSchema,
  ChapterUpdateBodySchema,
} from './chapters.js';
import { DatasetMetaSchema, ImportBodySchema, ImportResponseSchema } from './dataset.js';
import {
  InsightsResponseSchema,
  OverviewSchema,
  DashboardResponseSchema,
  CourseStatsSchema,
} from './dashboard.js';
import { KnowledgePayloadSchema, KnowledgeResponseSchema, QuizSchema } from './knowledge.js';
import {
  RecordDeleteResponseSchema,
  RecordErrorResponseSchema,
  RecordInputSchema,
  RecordMutationResponseSchema,
  RecordPatchSchema,
  RecordRowSchema,
  RecordsResponseSchema,
} from './records.js';
import {
  AdminUserSchema,
  CreateUserBodySchema,
  UpdateUserBodySchema,
  UserErrorResponseSchema,
  UserMutationResponseSchema,
  UsersResponseSchema,
} from './users.js';

/** Keep in sync with the published workspace version. */
export const OPENAPI_INFO_VERSION = '2.1.0';

/**
 * Stable tag names. Tags are part of the published contract: renaming one is a
 * breaking documentation change, so add new tags instead of repurposing these.
 */
export const OPENAPI_TAGS = [
  { name: 'Auth', description: '注册、登录、MFA、邮箱验证与密码管理（含 CSRF 发放）' },
  { name: 'Catalog', description: '公共课程目录与站点元信息' },
  { name: 'Chapters', description: '公共章节详情、视频与章节到达率' },
  { name: 'Knowledge', description: '知识中心文档（讲义原文、测验与要点）' },
  { name: 'Analytics', description: '学习看板与洞察（KPI 全部由学习记录计算）' },
  { name: 'Records', description: '学习记录 CRUD、CSV 导入导出（管理员）' },
  { name: 'Admin Users', description: '用户管理（管理员）' },
  { name: 'Admin Courses', description: '课程管理（管理员）' },
  { name: 'Admin Chapters', description: '章节管理（管理员）' },
  { name: 'Admin Audit', description: '只追加审计日志查询（管理员）' },
  { name: 'Admin Dataset', description: '数据集重置与快照恢复（管理员）' },
  { name: 'Media', description: '视频/封面等媒体资源（本地磁盘或 S3/MinIO）' },
  { name: 'Health', description: '进程存活与依赖就绪探针（不版本化）' },
] as const;

/**
 * OpenAPI meta-schemas that are not part of the zod runtime contracts but are
 * needed to describe routes that hand-roll their payloads (CSRF token,
 * dataset snapshots, media presigning).
 */
export const CsrfResponseSchema = z.object({ csrfToken: z.string() });

export const SnapshotRowSchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  reason: z.enum(['csv-import', 'seed-reset', 'pre-restore']),
  row_count: z.number().int().nonnegative(),
  actor_email: z.string().nullable(),
});

export const SnapshotsResponseSchema = z.object({ snapshots: z.array(SnapshotRowSchema) });

export const SnapshotRestoreResponseSchema = z.object({
  ok: z.literal(true),
  restored: z.number().int().nonnegative(),
  snapshot: SnapshotRowSchema,
  preRestoreSnapshot: SnapshotRowSchema,
  dataset: DatasetMetaSchema,
});

export const MediaPresignBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
});

export const MediaPresignResponseSchema = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  publicUrl: z.string(),
  expiresIn: z.number().int().positive(),
});

export const MediaUploadResponseSchema = z.object({ key: z.string(), url: z.string() });

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string; license?: { name: string } };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths?: Record<string, unknown>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
};

export type OpenApiBuildOptions = {
  /** Absolute public origin (e.g. `https://portal.example.com`). */
  serverUrl?: string;
};

const REF = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });

const ERROR_DESCRIPTIONS: Record<string, string> = {
  '400': '请求参数不合法（`errors[]` 给出逐条原因）',
  '401': '未登录或会话失效',
  '403': '权限不足（需要管理员或邮箱验证）',
  '404': '资源不存在',
  '409': '状态冲突（例如仍有关联学习记录）',
  '413': '请求体超过 2MB 限制',
  '416': 'Range 超出文件范围',
  '423': '账号因连续失败被临时锁定',
  '429': '触发限流，请稍后再试',
  '500': '服务端错误',
  '502': '邮件等上游服务失败（`code` 如 `MAIL_FAILED`）',
};

function errorResponse(status: string): ZodOpenApiResponseObject {
  return {
    description: ERROR_DESCRIPTIONS[status] ?? '错误响应',
    content: { 'application/json': { schema: REF('ApiError') } },
  };
}

function errors(...statuses: string[]): ZodOpenApiResponsesObject {
  const responses: Record<string, ZodOpenApiResponseObject> = {};
  for (const status of statuses) responses[status] = errorResponse(status);
  return responses as ZodOpenApiResponsesObject;
}

function jsonBody(schema: { $ref: string }) {
  return { content: { 'application/json': { schema } } };
}

function jsonOk(description: string, name: string): ZodOpenApiResponseObject {
  return { description, content: { 'application/json': { schema: REF(name) } } };
}

type SecurityRequirement = { [name: string]: string[] };

/** Cookie session alone (safe/idempotent GET or authentication-free POST). */
const SESSION: SecurityRequirement[] = [{ sessionCookie: [] }];
/** Cookie session plus the double-submit CSRF header. */
const SESSION_CSRF: SecurityRequirement[] = [{ sessionCookie: [], csrfToken: [] }];
/** Anonymous but still CSRF-protected (login/register/password flows). */
const CSRF_ONLY: SecurityRequirement[] = [{ csrfToken: [] }];
/** Public read-only endpoint. */
const ANONYMOUS: SecurityRequirement[] = [];

const pathParam = (name: string, description?: string) => ({
  in: 'path' as const,
  name,
  required: true,
  schema: { type: 'string' as const },
  ...(description ? { description } : {}),
});

const intPathParam = (name: string, description?: string) => ({
  in: 'path' as const,
  name,
  required: true,
  schema: { type: 'integer' as const, minimum: 1 },
  ...(description ? { description } : {}),
});

const queryParam = (name: string, description: string, schema?: Record<string, unknown>) => ({
  in: 'query' as const,
  name,
  required: false,
  schema: schema ?? { type: 'string' as const },
  description,
});

const RANGE_PARAM = {
  in: 'header' as const,
  name: 'Range',
  required: false,
  description: '单区间字节范围请求，例如 `bytes=0-99`；命中时返回 206。',
  schema: { type: 'string' as const },
  example: 'bytes=0-99',
};

const PAGINATION_PARAMS = [
  queryParam('limit', '每页数量（1–200，记录默认 20，审计默认 50）', {
    type: 'integer',
    minimum: 1,
    maximum: 200,
  }),
  queryParam('offset', '跳过条数（≥0）', { type: 'integer', minimum: 0 }),
];

const AUDIT_ACTION_ENUM = [...AUDIT_ACTIONS];

const BINARY = { type: 'string' as const, format: 'binary' as const };

/**
 * Build a fresh OpenAPI 3.1 object. Callers should cache it (the document is
 * static for a given config), but returning a new object keeps tests isolated.
 */
export function buildOpenApiDocument(options: OpenApiBuildOptions = {}): OpenApiDocument {
  const P = '/api/v1';

  const document = createDocument({
    openapi: '3.1.0',
    info: {
      title: 'AI Learning Portal API',
      version: OPENAPI_INFO_VERSION,
      description: [
        'AI 学习与数据分析门户 API（F036）。',
        '',
        '**会话**：浏览器登录后获得 HttpOnly `aip_session` Cookie（SameSite=Lax，7 天）。',
        '**CSRF**：变更请求必须同时携带可读 Cookie `aip_csrf` 与请求头 `X-CSRF-Token`；',
        '首次调用 `GET /api/v1/auth/csrf` 获取/刷新。无 `Origin` 的自然客户端（curl/CI）按 v1 行为放行。',
        '**错误**：所有失败响应为 `{error}`，校验错误附 `errors[]`，认证/邮件特例附 `code`。',
        '**分页**：offset 分页，响应为 `{total,limit,offset,rows,hasMore?}`。',
        '**别名**：规范路径为 `/api/v1`；旧 `/api` 挂载同一组处理器并带 `Deprecation` 响应头。',
        '所有数据均为模拟数据。',
      ].join('\n'),
      license: { name: 'MIT' },
    },
    ...(options.serverUrl
      ? { servers: [{ url: options.serverUrl, description: '当前部署' }] }
      : {}),
    tags: [...OPENAPI_TAGS],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'aip_session',
          description: 'HttpOnly 会话 Cookie（库中只存 SHA-256 摘要）。',
        },
        csrfCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'aip_csrf',
          description: '可读双提交 Cookie；值需与 `X-CSRF-Token` 请求头一致。',
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-CSRF-Token',
          description: '从 `aip_csrf` Cookie 读出并回填的 CSRF 令牌。',
        },
      },
      schemas: {
        // Shared envelopes.
        ApiError: ApiErrorSchema,
        SimpleOk: SimpleOkResponseSchema,
        MessageOk: MessageOkResponseSchema,
        CsrfResponse: CsrfResponseSchema,
        Healthz: z.object({ ok: z.literal(true), uptime: z.number().nonnegative() }),
        Readyz: z.object({ ok: z.boolean() }),
        PaginationMeta: z.object({
          total: z.number().int().nonnegative(),
          limit: z.number().int().positive(),
          offset: z.number().int().nonnegative(),
          hasMore: z.boolean().optional(),
        }),
        AuditAction: z.enum(AUDIT_ACTIONS),

        // Auth.
        ClientUser: z.object({
          id: z.number().int(),
          email: z.string(),
          name: z.string(),
          role: z.enum(['admin', 'learner']),
          emailVerified: z.boolean(),
          mfaEnabled: z.boolean(),
          active: z.boolean().optional(),
        }),
        MeResponse: MeResponseSchema,
        AuthUserResponse: AuthUserResponseSchema,
        RegisterResponse: RegisterResponseSchema,
        LoginResponse: LoginResponseSchema,
        MfaChallengeResponse: MfaChallengeResponseSchema,
        VerifyEmailResponse: VerifyEmailResponseSchema,
        MfaSetupResponse: MfaSetupResponseSchema,
        MfaEnableResponse: MfaEnableResponseSchema,
        RegisterBody: RegisterBodySchema,
        LoginBody: LoginBodySchema,
        MfaBody: MfaBodySchema,
        VerifyEmailBody: VerifyEmailBodySchema,
        ResendVerificationBody: ResendVerificationBodySchema,
        ForgotPasswordBody: ForgotPasswordBodySchema,
        ResetPasswordBody: ResetPasswordBodySchema,
        ChangePasswordBody: ChangePasswordBodySchema,
        MfaEnableBody: MfaEnableBodySchema,
        MfaDisableBody: MfaDisableBodySchema,

        // Public catalog / chapters / knowledge.
        Overview: OverviewSchema,
        CourseStats: CourseStatsSchema,
        CourseMeta: CourseMetaSchema,
        CourseWithStats: CourseWithStatsSchema,
        CoursesResponse: CoursesResponseSchema,
        CourseDetailResponse: CourseDetailResponseSchema,
        MetaResponse: MetaResponseSchema,
        ChapterRow: ChapterRowSchema,
        ChapterStat: ChapterStatSchema,
        ChapterCourse: ChapterCourseSchema,
        ChapterDetail: ChapterDetailSchema,
        ChapterResponse: ChapterResponseSchema,
        Quiz: QuizSchema,
        KnowledgePayload: KnowledgePayloadSchema,
        KnowledgeResponse: KnowledgeResponseSchema,

        // Analytics.
        DashboardResponse: DashboardResponseSchema,
        InsightsResponse: InsightsResponseSchema,

        // Records / CSV.
        RecordRow: RecordRowSchema,
        RecordsResponse: RecordsResponseSchema,
        RecordInput: RecordInputSchema,
        RecordPatch: RecordPatchSchema,
        RecordMutationResponse: RecordMutationResponseSchema,
        RecordDeleteResponse: RecordDeleteResponseSchema,
        RecordErrorResponse: RecordErrorResponseSchema,
        ImportBody: ImportBodySchema,
        ImportResponse: ImportResponseSchema,
        DatasetMeta: DatasetMetaSchema,

        // Admin users.
        AdminUser: AdminUserSchema,
        UsersResponse: UsersResponseSchema,
        CreateUserBody: CreateUserBodySchema,
        UpdateUserBody: UpdateUserBodySchema,
        UserMutationResponse: UserMutationResponseSchema,
        UserErrorResponse: UserErrorResponseSchema,

        // Admin courses / chapters.
        AdminCourse: AdminCourseSchema,
        AdminCoursesResponse: AdminCoursesResponseSchema,
        CourseCreateBody: CourseCreateBodySchema,
        CourseUpdateBody: CourseUpdateBodySchema,
        CourseMutationResponse: CourseMutationResponseSchema,
        CourseDeleteResponse: CourseDeleteResponseSchema,
        ChapterCreateBody: ChapterCreateBodySchema,
        ChapterUpdateBody: ChapterUpdateBodySchema,
        ChapterMutationResponse: ChapterMutationResponseSchema,

        // Admin audit / dataset snapshots.
        AuditRow: AuditRowSchema,
        AuditResponse: AuditResponseSchema,
        SnapshotRow: SnapshotRowSchema,
        SnapshotsResponse: SnapshotsResponseSchema,
        SnapshotRestoreResponse: SnapshotRestoreResponseSchema,

        // Media.
        MediaPresignBody: MediaPresignBodySchema,
        MediaPresignResponse: MediaPresignResponseSchema,
        MediaUploadResponse: MediaUploadResponseSchema,
      },
    },
    paths: {
      /* ------------------------------- Health -------------------------------- */
      '/healthz': {
        get: {
          tags: ['Health'],
          summary: '进程存活检查',
          description: '只检查进程本身，不访问 PostgreSQL/Redis。',
          operationId: 'getHealthz',
          security: ANONYMOUS,
          responses: {
            '200': jsonOk('进程存活', 'Healthz'),
          },
        },
      },
      '/readyz': {
        get: {
          tags: ['Health'],
          summary: '依赖就绪检查',
          description: '检查 PostgreSQL、Redis 与迁移版本；任一失败返回 503 `{ok:false}`。',
          operationId: 'getReadyz',
          security: ANONYMOUS,
          responses: {
            '200': jsonOk('依赖全部就绪', 'Readyz'),
            '503': {
              description: '依赖不可用（数据库/Redis/迁移）',
              content: { 'application/json': { schema: REF('Readyz') } },
            },
          },
        },
      },

      /* -------------------------------- Auth --------------------------------- */
      [`${P}/auth/csrf`]: {
        get: {
          tags: ['Auth'],
          summary: '获取/刷新 CSRF 令牌',
          description:
            '返回 `csrfToken` 并设置可读 `aip_csrf` Cookie。SPA 启动时若 Cookie 缺失则调用一次。',
          operationId: 'getCsrfToken',
          security: ANONYMOUS,
          responses: {
            '200': {
              description: 'CSRF 令牌（同时下发 `aip_csrf` Cookie）',
              headers: {
                'Set-Cookie': {
                  description: '`aip_csrf=<token>; Path=/; SameSite=Lax`（可在 SPA 读取）',
                  schema: { type: 'string' },
                },
              },
              content: { 'application/json': { schema: REF('CsrfResponse') } },
            },
          },
        },
      },
      [`${P}/auth/me`]: {
        get: {
          tags: ['Auth'],
          summary: '当前会话用户',
          description: '未登录时返回 200 `{user:null}`（与 v1 一致）。',
          operationId: 'getMe',
          security: SESSION,
          responses: {
            '200': {
              description: '当前用户或 null',
              content: { 'application/json': { schema: REF('MeResponse') } },
            },
            ...errors('401', '500'),
          },
        },
      },
      [`${P}/auth/register`]: {
        post: {
          tags: ['Auth'],
          summary: '注册',
          description:
            '开发环境直接登录；生产环境发送验证邮件并返回 `{verificationRequired:true,email}`。',
          operationId: 'register',
          security: CSRF_ONLY,
          requestBody: { required: true, ...jsonBody(REF('RegisterBody')) },
          responses: {
            '201': jsonOk('注册成功（已登录或待验证）', 'RegisterResponse'),
            ...errors('400', '413', '429'),
          },
        },
      },
      [`${P}/auth/login`]: {
        post: {
          tags: ['Auth'],
          summary: '登录',
          description:
            '成功返回 `{user}` 并设置 `aip_session`；启用 MFA 时返回 5 分钟挑战 `{mfaRequired,challengeToken}`。',
          operationId: 'login',
          security: CSRF_ONLY,
          requestBody: { required: true, ...jsonBody(REF('LoginBody')) },
          responses: {
            '200': {
              description: '登录成功或需要 MFA',
              headers: {
                'Set-Cookie': {
                  description: '成功时设置 `aip_session`（HttpOnly/SameSite=Lax）',
                  schema: { type: 'string' },
                },
              },
              content: { 'application/json': { schema: REF('LoginResponse') } },
            },
            ...errors('400', '403', '423', '429', '502'),
          },
        },
      },
      [`${P}/auth/mfa`]: {
        post: {
          tags: ['Auth'],
          summary: '校验 MFA 挑战',
          description: '使用登录返回的 `challengeToken` 与 TOTP/恢复码换取会话。',
          operationId: 'verifyMfa',
          security: CSRF_ONLY,
          requestBody: { required: true, ...jsonBody(REF('MfaBody')) },
          responses: {
            '200': jsonOk('MFA 校验成功并登录', 'AuthUserResponse'),
            ...errors('400', '423', '429'),
          },
        },
      },
      [`${P}/auth/verify-email`]: {
        post: {
          tags: ['Auth'],
          summary: '兑换邮箱验证令牌',
          description: '令牌 24 小时有效，兑换时强制校验过期。',
          operationId: 'verifyEmail',
          security: CSRF_ONLY,
          requestBody: { required: true, ...jsonBody(REF('VerifyEmailBody')) },
          responses: {
            '200': jsonOk('验证成功（可能直接登录或进入 MFA 挑战）', 'VerifyEmailResponse'),
            ...errors('400', '429'),
          },
        },
      },
      [`${P}/auth/resend-verification`]: {
        post: {
          tags: ['Auth'],
          summary: '重发验证邮件',
          operationId: 'resendVerification',
          security: CSRF_ONLY,
          requestBody: { required: true, ...jsonBody(REF('ResendVerificationBody')) },
          responses: {
            '200': jsonOk('已受理（不泄露邮箱是否存在）', 'MessageOk'),
            ...errors('400', '429', '502'),
          },
        },
      },
      [`${P}/auth/forgot-password`]: {
        post: {
          tags: ['Auth'],
          summary: '申请重置密码',
          operationId: 'forgotPassword',
          security: CSRF_ONLY,
          requestBody: { required: true, ...jsonBody(REF('ForgotPasswordBody')) },
          responses: {
            '200': jsonOk('已受理（不泄露邮箱是否存在）', 'MessageOk'),
            ...errors('400', '429', '502'),
          },
        },
      },
      [`${P}/auth/reset-password`]: {
        post: {
          tags: ['Auth'],
          summary: '使用令牌重置密码',
          description: '重置令牌 1 小时有效，兑换时强制校验过期。',
          operationId: 'resetPassword',
          security: CSRF_ONLY,
          requestBody: { required: true, ...jsonBody(REF('ResetPasswordBody')) },
          responses: {
            '200': jsonOk('密码已重置', 'SimpleOk'),
            ...errors('400', '429'),
          },
        },
      },
      [`${P}/auth/change-password`]: {
        post: {
          tags: ['Auth'],
          summary: '修改密码',
          description: '需要已登录会话；按账户维度限流 10 次/10 分钟。',
          operationId: 'changePassword',
          security: SESSION_CSRF,
          requestBody: { required: true, ...jsonBody(REF('ChangePasswordBody')) },
          responses: {
            '200': jsonOk('密码已修改', 'SimpleOk'),
            ...errors('400', '401', '429'),
          },
        },
      },
      [`${P}/auth/mfa/setup`]: {
        post: {
          tags: ['Auth'],
          summary: '开始 MFA 设置',
          description: '生成 TOTP 密钥（加密存储）并返回 `otpauth` URI。',
          operationId: 'setupMfa',
          security: SESSION_CSRF,
          responses: {
            '200': jsonOk('TOTP 密钥与 otpauth URI', 'MfaSetupResponse'),
            ...errors('400', '401'),
          },
        },
      },
      [`${P}/auth/mfa/enable`]: {
        post: {
          tags: ['Auth'],
          summary: '启用 MFA',
          description: '校验 6 位 TOTP 后启用，返回 8 枚一次性恢复码。',
          operationId: 'enableMfa',
          security: SESSION_CSRF,
          requestBody: { required: true, ...jsonBody(REF('MfaEnableBody')) },
          responses: {
            '200': jsonOk('恢复码列表', 'MfaEnableResponse'),
            ...errors('400', '401', '429'),
          },
        },
      },
      [`${P}/auth/mfa/disable`]: {
        post: {
          tags: ['Auth'],
          summary: '关闭 MFA',
          description: '需要当前密码确认。',
          operationId: 'disableMfa',
          security: SESSION_CSRF,
          requestBody: { required: true, ...jsonBody(REF('MfaDisableBody')) },
          responses: {
            '200': jsonOk('MFA 已关闭', 'SimpleOk'),
            ...errors('400', '401', '429'),
          },
        },
      },
      [`${P}/auth/logout`]: {
        post: {
          tags: ['Auth'],
          summary: '退出登录',
          description: '清除会话 Cookie 并使服务端会话失效；匿名调用也返回 200。',
          operationId: 'logout',
          security: CSRF_ONLY,
          responses: {
            '200': {
              description: '已退出并清除 `aip_session`',
              headers: {
                'Set-Cookie': { description: '清除会话 Cookie', schema: { type: 'string' } },
              },
              content: { 'application/json': { schema: REF('SimpleOk') } },
            },
            ...errors('429'),
          },
        },
      },

      /* ------------------------------- Catalog -------------------------------- */
      [`${P}/meta`]: {
        get: {
          tags: ['Catalog'],
          summary: '站点概览与数据集元信息',
          operationId: 'getMeta',
          security: ANONYMOUS,
          responses: { '200': jsonOk('概览、数据集元信息与课程引用', 'MetaResponse') },
        },
      },
      [`${P}/courses`]: {
        get: {
          tags: ['Catalog'],
          summary: '课程广场',
          description: '课程带分课程统计、全部分类与站点概览；筛选不改变站点概览。',
          operationId: 'listCourses',
          security: ANONYMOUS,
          parameters: [
            queryParam('q', '按名称、简介、讲师或分类模糊匹配'),
            queryParam('category', '按分类精确匹配'),
          ],
          responses: { '200': jsonOk('课程列表、分类与概览', 'CoursesResponse') },
        },
      },
      [`${P}/courses/{idOrName}`]: {
        get: {
          tags: ['Catalog'],
          summary: '课程详情',
          operationId: 'getCourse',
          security: ANONYMOUS,
          parameters: [pathParam('idOrName', '课程 id（如 C1）或课程名')],
          responses: {
            '200': jsonOk('课程、统计与章节到达率', 'CourseDetailResponse'),
            ...errors('404'),
          },
        },
      },

      /* ------------------------------- Chapters ------------------------------- */
      [`${P}/chapters/{courseId}/{idx}`]: {
        get: {
          tags: ['Chapters'],
          summary: '章节详情',
          description: '返回章节正文、解析后的视频、该章到达率、关联测验与相邻章节。',
          operationId: 'getChapter',
          security: ANONYMOUS,
          parameters: [
            pathParam('courseId', '课程 id 或名称'),
            {
              in: 'path',
              name: 'idx',
              required: true,
              description: '章节序号（非负整数）',
              schema: { type: 'integer', minimum: 0 },
            },
          ],
          responses: {
            '200': jsonOk('章节、课程、统计与相邻导航', 'ChapterResponse'),
            ...errors('404'),
          },
        },
      },

      /* ------------------------------- Knowledge ------------------------------ */
      [`${P}/knowledge/{id}`]: {
        get: {
          tags: ['Knowledge'],
          summary: '知识中心文档',
          description: '未知课程返回 404；课程存在但没有知识文档时 `knowledge:null`。',
          operationId: 'getKnowledge',
          security: ANONYMOUS,
          parameters: [pathParam('id', '课程 id')],
          responses: {
            '200': jsonOk('课程引用与知识文档', 'KnowledgeResponse'),
            ...errors('404'),
          },
        },
      },

      /* ------------------------------- Analytics ------------------------------ */
      [`${P}/dashboard`]: {
        get: {
          tags: ['Analytics'],
          summary: '学习看板',
          description:
            '全部 KPI、图表分组与洞察由 `@portal/domain` 从学习记录计算；未知课程回退为全站。',
          operationId: 'getDashboard',
          security: ANONYMOUS,
          parameters: [queryParam('course', '按课程名精确筛选')],
          responses: { '200': jsonOk('看板数据', 'DashboardResponse') },
        },
      },
      [`${P}/insights`]: {
        get: {
          tags: ['Analytics'],
          summary: '数据洞察',
          operationId: 'getInsights',
          security: ANONYMOUS,
          responses: { '200': jsonOk('洞察、指标陷阱与数据质量', 'InsightsResponse') },
        },
      },

      /* -------------------------------- Records ------------------------------- */
      [`${P}/records`]: {
        get: {
          tags: ['Records'],
          summary: '学习记录列表',
          description: '管理员专用；固定排序 `learning_date DESC, student_id, id`。',
          operationId: 'listRecords',
          security: SESSION,
          parameters: [
            queryParam('course', '按课程名筛选'),
            queryParam('student', '按学生 id 筛选'),
            queryParam('q', '学生 id 或课程名模糊搜索'),
            ...PAGINATION_PARAMS,
          ],
          responses: {
            '200': jsonOk('分页学习记录', 'RecordsResponse'),
            ...errors('401', '403', '500'),
          },
        },
        post: {
          tags: ['Records'],
          summary: '新建学习记录',
          operationId: 'createRecord',
          security: SESSION_CSRF,
          requestBody: { required: true, ...jsonBody(REF('RecordInput')) },
          responses: {
            '201': jsonOk('创建后的记录与数据集元信息', 'RecordMutationResponse'),
            '400': {
              description: '字段校验失败（`{ok:false,errors[]}`）',
              content: { 'application/json': { schema: REF('RecordErrorResponse') } },
            },
            '401': errorResponse('401'),
            '403': errorResponse('403'),
          },
        },
      },
      [`${P}/records/{id}`]: {
        patch: {
          tags: ['Records'],
          summary: '更新学习记录',
          description: 'PATCH 提交任意可编辑字段的非空子集；服务端对合并后的整行重新校验。',
          operationId: 'updateRecord',
          security: SESSION_CSRF,
          parameters: [intPathParam('id', '记录 id')],
          requestBody: { required: true, ...jsonBody(REF('RecordPatch')) },
          responses: {
            '200': jsonOk('更新后的记录与数据集元信息', 'RecordMutationResponse'),
            '400': {
              description: '字段校验失败（`{ok:false,errors[]}`）',
              content: { 'application/json': { schema: REF('RecordErrorResponse') } },
            },
            '401': errorResponse('401'),
            '403': errorResponse('403'),
            '404': {
              description: '记录不存在',
              content: { 'application/json': { schema: REF('RecordErrorResponse') } },
            },
          },
        },
        delete: {
          tags: ['Records'],
          summary: '删除学习记录',
          operationId: 'deleteRecord',
          security: SESSION_CSRF,
          parameters: [intPathParam('id', '记录 id')],
          responses: {
            '200': jsonOk('已删除并返回数据集元信息', 'RecordDeleteResponse'),
            '401': errorResponse('401'),
            '403': errorResponse('403'),
            '404': {
              description: '记录不存在',
              content: { 'application/json': { schema: REF('RecordErrorResponse') } },
            },
          },
        },
      },
      [`${P}/records/import`]: {
        post: {
          tags: ['Records'],
          summary: 'CSV 导入（整体替换）',
          description:
            '接受 JSON `{csv}` 或原始 `text/csv`（2MB 上限）；`dry_run`/`dryRun` 只校验不写入。',
          operationId: 'importRecordsCsv',
          security: SESSION_CSRF,
          parameters: [
            queryParam('dry_run', 'dry-run 开关：1/true 只校验不写入', {
              type: 'string',
              enum: ['0', '1', 'true', 'false'],
            }),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: REF('ImportBody') },
              'text/csv': { schema: { type: 'string' } },
            },
          },
          responses: {
            '200': jsonOk('导入结果与刷新后的数据集元信息', 'ImportResponse'),
            ...errors('400', '401', '403', '413'),
          },
        },
      },
      [`${P}/export.csv`]: {
        get: {
          tags: ['Records'],
          summary: '导出学习记录 CSV',
          description: 'UTF-8 BOM + CRLF，固定列顺序；管理员专用。',
          operationId: 'exportRecordsCsv',
          security: SESSION,
          responses: {
            '200': {
              description: 'CSV 附件（`learning_records.csv`）',
              headers: {
                'Content-Disposition': {
                  description: '`attachment; filename="learning_records.csv"`',
                  schema: { type: 'string' },
                },
              },
              content: { 'text/csv': { schema: BINARY } },
            },
            ...errors('401', '403'),
          },
        },
      },

      /* -------------------------------- Admin Users -------------------------- */
      [`${P}/admin/users`]: {
        get: {
          tags: ['Admin Users'],
          summary: '用户列表',
          description: '只返回安全字段（无密码哈希、无 MFA 密钥）。',
          operationId: 'listUsers',
          security: SESSION,
          responses: {
            '200': jsonOk('用户列表', 'UsersResponse'),
            ...errors('401', '403'),
          },
        },
        post: {
          tags: ['Admin Users'],
          summary: '创建用户',
          description: '默认活跃且已验证；邮箱大小写不敏感唯一。',
          operationId: 'createUser',
          security: SESSION_CSRF,
          requestBody: { required: true, ...jsonBody(REF('CreateUserBody')) },
          responses: {
            '201': jsonOk('创建成功', 'UserMutationResponse'),
            ...errors('400', '401', '403'),
          },
        },
      },
      [`${P}/admin/users/{id}`]: {
        patch: {
          tags: ['Admin Users'],
          summary: '更新用户',
          description:
            '支持 name/role/active/password/unlock/emailVerified/resetMfa；最后管理员与自操作受保护。',
          operationId: 'updateUser',
          security: SESSION_CSRF,
          parameters: [intPathParam('id', '用户 id')],
          requestBody: { required: true, ...jsonBody(REF('UpdateUserBody')) },
          responses: {
            '200': jsonOk('更新后的用户', 'UserMutationResponse'),
            '400': {
              description: '校验失败（`{ok:false,errors[]}`）',
              content: { 'application/json': { schema: REF('UserErrorResponse') } },
            },
            '401': errorResponse('401'),
            '403': errorResponse('403'),
            '404': {
              description: '用户不存在',
              content: { 'application/json': { schema: REF('UserErrorResponse') } },
            },
          },
        },
      },

      /* ------------------------------- Admin Courses ------------------------- */
      [`${P}/admin/courses`]: {
        get: {
          tags: ['Admin Courses'],
          summary: '课程列表（含统计与章节正文）',
          operationId: 'listAdminCourses',
          security: SESSION,
          responses: {
            '200': jsonOk('课程管理列表', 'AdminCoursesResponse'),
            ...errors('401', '403'),
          },
        },
        post: {
          tags: ['Admin Courses'],
          summary: '创建课程',
          description: 'id 由 `course_seq` 单调分配（如 C6），名称唯一。',
          operationId: 'createCourse',
          security: SESSION_CSRF,
          requestBody: { required: true, ...jsonBody(REF('CourseCreateBody')) },
          responses: {
            '201': jsonOk('创建成功', 'CourseMutationResponse'),
            ...errors('400', '401', '403'),
          },
        },
      },
      [`${P}/admin/courses/{id}`]: {
        patch: {
          tags: ['Admin Courses'],
          summary: '更新课程',
          description: '支持元数据与三态视频配置（inherit/custom/none）；改名不重写历史记录。',
          operationId: 'updateCourse',
          security: SESSION_CSRF,
          parameters: [pathParam('id', '课程 id')],
          requestBody: { required: true, ...jsonBody(REF('CourseUpdateBody')) },
          responses: {
            '200': jsonOk('更新成功', 'CourseMutationResponse'),
            ...errors('400', '401', '403', '404'),
          },
        },
        delete: {
          tags: ['Admin Courses'],
          summary: '删除课程',
          description: '仍有关联学习记录时返回 409；`force=1` 在同一事务内删除记录、章节、知识与课程。',
          operationId: 'deleteCourse',
          security: SESSION_CSRF,
          parameters: [
            pathParam('id', '课程 id'),
            queryParam('force', '强制删除开关（`1`）', { type: 'string', enum: ['1'] }),
          ],
          responses: {
            '200': jsonOk('删除成功（含删除记录数）', 'CourseDeleteResponse'),
            ...errors('401', '403', '404', '409'),
          },
        },
      },

      /* ------------------------------ Admin Chapters ------------------------- */
      [`${P}/admin/courses/{courseId}/chapters`]: {
        post: {
          tags: ['Admin Chapters'],
          summary: '追加章节',
          description: '索引为当前最大 idx + 1，按课程 advisory lock 串行化。',
          operationId: 'createChapter',
          security: SESSION_CSRF,
          parameters: [pathParam('courseId', '课程 id')],
          requestBody: { required: true, ...jsonBody(REF('ChapterCreateBody')) },
          responses: {
            '201': jsonOk('创建成功', 'ChapterMutationResponse'),
            ...errors('400', '401', '403', '404'),
          },
        },
      },
      [`${P}/admin/courses/{courseId}/chapters/{idx}`]: {
        patch: {
          tags: ['Admin Chapters'],
          summary: '更新章节',
          operationId: 'updateChapter',
          security: SESSION_CSRF,
          parameters: [
            pathParam('courseId', '课程 id'),
            {
              in: 'path',
              name: 'idx',
              required: true,
              schema: { type: 'integer', minimum: 0 },
            },
          ],
          requestBody: { required: true, ...jsonBody(REF('ChapterUpdateBody')) },
          responses: {
            '200': jsonOk('更新成功', 'ChapterMutationResponse'),
            ...errors('400', '401', '403', '404'),
          },
        },
        delete: {
          tags: ['Admin Chapters'],
          summary: '删除章节',
          description: '保留索引空缺，不重排后续章节。',
          operationId: 'deleteChapter',
          security: SESSION_CSRF,
          parameters: [
            pathParam('courseId', '课程 id'),
            {
              in: 'path',
              name: 'idx',
              required: true,
              schema: { type: 'integer', minimum: 0 },
            },
          ],
          responses: {
            '200': jsonOk('删除成功', 'SimpleOk'),
            ...errors('401', '403', '404'),
          },
        },
      },

      /* -------------------------------- Admin Audit -------------------------- */
      [`${P}/admin/audit`]: {
        get: {
          tags: ['Admin Audit'],
          summary: '查询审计日志',
          description: '按 `id DESC` 返回；`details` 为解析后的 JSON 对象。',
          operationId: 'listAudit',
          security: SESSION,
          parameters: [
            ...PAGINATION_PARAMS,
            queryParam('action', '按审计事件名精确过滤', {
              type: 'string',
              enum: AUDIT_ACTION_ENUM,
            }),
          ],
          responses: {
            '200': jsonOk('分页审计日志', 'AuditResponse'),
            ...errors('401', '403'),
          },
        },
      },

      /* ------------------------------- Admin Dataset ------------------------- */
      [`${P}/admin/reset`]: {
        post: {
          tags: ['Admin Dataset'],
          summary: '恢复示例数据集',
          description: '生产环境需显式 `ALLOW_DEMO_RESET=1`，否则 403。',
          operationId: 'resetDataset',
          security: SESSION_CSRF,
          responses: {
            '200': jsonOk('重置结果与数据集元信息', 'ImportResponse'),
            ...errors('401', '403', '500'),
          },
        },
      },
      [`${P}/admin/dataset/snapshots`]: {
        get: {
          tags: ['Admin Dataset'],
          summary: '列出数据集快照',
          description: '破坏性导入/重置前写入的快照，最新在前。',
          operationId: 'listDatasetSnapshots',
          security: SESSION,
          responses: {
            '200': jsonOk('快照列表', 'SnapshotsResponse'),
            ...errors('401', '403'),
          },
        },
      },
      [`${P}/admin/dataset/restore/{id}`]: {
        post: {
          tags: ['Admin Dataset'],
          summary: '恢复到指定快照',
          description:
            '恢复前先把当前行保存为 `pre-restore` 快照，因此恢复本身也可回滚；写 `data.snapshot_restored`/`data.snapshot_created` 审计。',
          operationId: 'restoreDatasetSnapshot',
          security: SESSION_CSRF,
          parameters: [intPathParam('id', '快照 id')],
          responses: {
            '200': jsonOk('恢复结果（含恢复前快照）', 'SnapshotRestoreResponse'),
            ...errors('400', '401', '403', '404', '409'),
          },
        },
      },

      /* --------------------------------- Media ------------------------------- */
      [`${P}/media/{key}`]: {
        get: {
          tags: ['Media'],
          summary: '读取媒体资源',
          description:
            '本地驱动直接流式返回并支持单区间 Range；S3/MinIO 驱动返回短时有效的预签名跳转。密钥不进入前端。',
          operationId: 'getMedia',
          security: ANONYMOUS,
          parameters: [
            pathParam('key', '媒体对象键（不含路径穿越）'),
            RANGE_PARAM,
          ],
          responses: {
            '200': {
              description: '完整媒体内容',
              content: {
                'video/mp4': { schema: BINARY },
                'image/*': { schema: BINARY },
                'application/octet-stream': { schema: BINARY },
              },
            },
            '206': {
              description: '单区间部分内容',
              headers: {
                'Content-Range': {
                  description: '`bytes start-end/total`',
                  schema: { type: 'string' },
                },
              },
              content: {
                'video/mp4': { schema: BINARY },
                'application/octet-stream': { schema: BINARY },
              },
            },
            '302': {
              description: 'S3/MinIO 模式下跳转到短时有效的预签名 GET URL',
              headers: {
                Location: { description: '预签名媒体 URL', schema: { type: 'string' } },
              },
            },
            '404': errorResponse('404'),
            '416': { description: 'Range 不可满足（空响应体，`Content-Range: bytes */size`）' },
          },
        },
      },
      [`${P}/admin/media/presign`]: {
        post: {
          tags: ['Media'],
          summary: '获取媒体上传预签名 URL',
          description: '仅 `STORAGE_DRIVER=s3`（MinIO/AWS）时可用；返回短时有效的 PUT URL。',
          operationId: 'presignMediaUpload',
          security: SESSION_CSRF,
          requestBody: { required: true, ...jsonBody(REF('MediaPresignBody')) },
          responses: {
            '200': jsonOk('对象键、上传 URL、公开 URL 与有效期（秒）', 'MediaPresignResponse'),
            ...errors('400', '401', '403'),
          },
        },
      },
      [`${P}/admin/media/upload`]: {
        post: {
          tags: ['Media'],
          summary: '直传媒体（本地驱动）',
          description:
            '仅 `STORAGE_DRIVER=local` 可用；原始字节流，受 `MEDIA_MAX_BYTES` 限制（默认 50MB）。S3 模式请改用 presign。',
          operationId: 'uploadMedia',
          security: SESSION_CSRF,
          parameters: [
            queryParam('key', '客户端指定对象键（可选）'),
            queryParam('filename', '用于生成对象键的原始文件名（可选）'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': { schema: BINARY },
              'video/mp4': { schema: BINARY },
              'image/png': { schema: BINARY },
              'image/jpeg': { schema: BINARY },
            },
          },
          responses: {
            '201': jsonOk('对象键与公开 URL', 'MediaUploadResponse'),
            ...errors('400', '401', '403', '413'),
          },
        },
      },
      '/assets/{path}': {
        get: {
          tags: ['Media'],
          summary: '静态媒体资源（/assets）',
          description:
            '开发与单进程模式下的占位视频/封面，`express.static` 提供单区间 Range（206/416）。',
          operationId: 'getStaticAsset',
          security: ANONYMOUS,
          parameters: [pathParam('path', 'assets 下的相对路径'), RANGE_PARAM],
          responses: {
            '200': {
              description: '静态文件',
              content: { 'application/octet-stream': { schema: BINARY } },
            },
            '206': {
              description: '部分内容',
              headers: {
                'Content-Range': {
                  description: '`bytes start-end/total`',
                  schema: { type: 'string' },
                },
              },
              content: { 'application/octet-stream': { schema: BINARY } },
            },
            '404': { description: '文件不存在' },
            '416': { description: 'Range 不可满足（空响应体）' },
          },
        },
      },
    },
  });

  return document as unknown as OpenApiDocument;
}

// Keep the operation type import meaningful for consumers that augment paths.
export type OpenApiOperation = ZodOpenApiOperationObject;