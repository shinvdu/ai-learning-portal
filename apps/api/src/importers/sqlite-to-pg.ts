/**
 * F100: SQLite (v1 `data/portal.db`) → PostgreSQL importer.
 *
 * Reads the v1 database strictly read-only through `node:sqlite`, validates
 * every row against the v2 constraints, and writes the result in a single
 * PostgreSQL transaction. `--dry-run` prints source counts and discrepancies
 * without touching the target; run it before the default (applying) mode.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run import:sqlite -- [options]
 *
 * Options:
 *   --db <path>          Source SQLite file (default: <repo>/data/portal.db)
 *   --dry-run            Validate and report only; never write to PostgreSQL
 *   --wipe               TRUNCATE the imported tables before inserting
 *   --include-sessions   Also import unexpired sessions/auth tokens
 *   --help               Show usage
 *
 * Mapping highlights:
 *   - users: ids preserved, email lowercased, scrypt hashes copied verbatim,
 *     0/1 → boolean, epoch-ms lockout → timestamptz, plaintext TOTP secrets
 *     encrypted with the v2 secret box (`MFA_ENC_KEY`).
 *   - courses: ids preserved; `chapters_json` archived in `app_meta` as
 *     `legacy_chapters_<id>`; `video_json` NULL → `inherit`, the JSON string
 *     "null" → `none`, an object → `custom` + `video`.
 *   - records: `course_name` → `course_id`; strict calendar-date and range
 *     validation. Ids are preserved so re-running is idempotent.
 *   - audit_log, mfa_recovery_codes, app_meta, chapters, knowledge copied 1:1.
 *   - sessions/auth_tokens are skipped unless `--include-sessions`; only
 *     unexpired rows are considered even then.
 *   - `course_seq` and the identity sequences are advanced past max(id).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import {
  encryptSecret,
  groupEnrollments,
  isCalendarDate,
  summarize,
  type LearningRecord,
} from '@portal/domain';
import { DEV_MFA_KEY_SEED, deriveMfaKey } from '../modules/auth/mfa.js';

/* ------------------------------- constants -------------------------------- */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const DEFAULT_DB_PATH = path.join(REPO_ROOT, 'data', 'portal.db');

const TABLE_NAMES = [
  'users',
  'courses',
  'chapters',
  'knowledge',
  'records',
  'audit_log',
  'mfa_recovery_codes',
  'sessions',
  'auth_tokens',
  'app_meta',
] as const;

type TableName = (typeof TABLE_NAMES)[number];

/** Target table → v1 SQLite table name (`meta` became `app_meta` in v2). */
const SOURCE_TABLE: Record<TableName, string> = {
  users: 'users',
  courses: 'courses',
  chapters: 'chapters',
  knowledge: 'knowledge',
  records: 'records',
  audit_log: 'audit_log',
  mfa_recovery_codes: 'mfa_recovery_codes',
  sessions: 'sessions',
  auth_tokens: 'auth_tokens',
  app_meta: 'meta',
};

const IDENTITY_SEQUENCES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'users', column: 'id' },
  { table: 'records', column: 'id' },
  { table: 'audit_log', column: 'id' },
  { table: 'mfa_recovery_codes', column: 'id' },
];

const OPTIONAL_SOURCE_TABLES = new Set<TableName>([
  'audit_log',
  'mfa_recovery_codes',
  'sessions',
  'auth_tokens',
]);

const REQUIRED_SOURCE_TABLES = TABLE_NAMES.filter((name) => !OPTIONAL_SOURCE_TABLES.has(name));

const USER_ROLES = new Set(['admin', 'learner']);
const TOKEN_TYPES = new Set(['verify', 'reset', 'mfa']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COURSE_ID_PATTERN = /^C\d+$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/* --------------------------------- types ---------------------------------- */

type SqliteRecord = Record<string, unknown>;

export type CliOptions = {
  dbPath: string;
  dryRun: boolean;
  wipe: boolean;
  includeSessions: boolean;
  databaseUrl: string;
};

export type ImportOptions = {
  dbPath: string;
  databaseUrl?: string;
  dryRun?: boolean;
  wipe?: boolean;
  includeSessions?: boolean;
  /** Injectable clock for session-expiry tests. */
  now?: Date;
};

export type TableImportCount = {
  /** Rows present in SQLite. */
  source: number;
  /** Rows that passed validation and target conflict checks. */
  valid: number;
  /** source - valid (validation errors + target conflicts). */
  skipped: number;
  /** Target row count before the import. */
  targetBefore: number;
  /** Target row count after the import; null on a dry run. */
  targetAfter: number | null;
};

export type GoldenMetrics = {
  students: number;
  courses: number;
  enrollments: number;
  records: number;
  avgCompletion: number | null;
  avgScore: number | null;
  noScoreEnrollments: number;
  totalHours: number | null;
};

export type ImportReport = {
  mode: 'dry-run' | 'apply';
  dbPath: string;
  targetDatabase: string;
  wipe: boolean;
  includeSessions: boolean;
  counts: Record<TableName, TableImportCount>;
  issues: string[];
  discrepancies: string[];
  videoModes: { inherit: number; custom: number; none: number };
  sessions: { total: number; unexpired: number; expired: number; included: boolean };
  golden: GoldenMetrics;
  sequences: { course: number; users: number; records: number; auditLog: number; mfaRecoveryCodes: number };
};

type ValidUser = {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: 'admin' | 'learner';
  active: boolean;
  email_verified: boolean;
  failed_attempts: number;
  locked_until: string | null;
  mfa_secret: string | null;
  mfa_enabled: boolean;
  created_at: string;
  last_login_at: string | null;
  /** true when the source stored a non-empty plaintext TOTP secret. */
  hasMfaSecret: boolean;
};

type ValidCourse = {
  id: string;
  name: string;
  category: string;
  teacher: string;
  level: string;
  badge: string | null;
  color: string | null;
  intro: string | null;
  video_mode: 'inherit' | 'custom' | 'none';
  video: Record<string, unknown> | null;
  sort_order: number;
  legacy_chapters: string | null;
};

type ValidChapter = { course_id: string; idx: number; title: string; body: string };
type ValidKnowledge = { course_id: string; payload: unknown };
type ValidRecord = {
  id: number;
  student_id: string;
  course_id: string;
  course_name: string;
  learning_date: string;
  learning_minutes: number;
  chapters_done: number;
  total_chapters: number;
  quiz_score: number | null;
  created_at: string;
};
type ValidAudit = {
  id: number;
  created_at: string;
  actor_user_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  details: unknown;
};
type ValidRecovery = {
  id: number;
  user_id: number;
  code_hash: string;
  used_at: string | null;
  created_at: string;
};
type ValidSession = { id: string; user_id: number; expires_at: string; created_at: string };
type ValidAuthToken = {
  id: string;
  user_id: number;
  type: 'verify' | 'reset' | 'mfa';
  expires_at: string;
  used_at: string | null;
  created_at: string;
};
type ValidMeta = { key: string; value: string | null };

export type SourceSnapshot = {
  path: string;
  users: ValidUser[];
  courses: ValidCourse[];
  chapters: ValidChapter[];
  knowledge: ValidKnowledge[];
  records: ValidRecord[];
  audit: ValidAudit[];
  recovery: ValidRecovery[];
  sessions: ValidSession[];
  authTokens: ValidAuthToken[];
  meta: ValidMeta[];
  /** Source row counts before validation. */
  sourceCounts: Record<TableName, number>;
  issues: string[];
  videoModes: { inherit: number; custom: number; none: number };
  sessionsTotal: number;
};

type TargetState = {
  counts: Record<TableName, number>;
  courseIdsByName: Map<string, string>;
  courseNamesById: Map<string, string>;
  userIdsByEmail: Map<string, number>;
};

type ImportPlan = {
  users: ValidUser[];
  courses: ValidCourse[];
  chapters: ValidChapter[];
  knowledge: ValidKnowledge[];
  records: ValidRecord[];
  audit: ValidAudit[];
  recovery: ValidRecovery[];
  sessions: ValidSession[];
  authTokens: ValidAuthToken[];
  meta: ValidMeta[];
  skipped: Record<TableName, number>;
  issues: string[];
  discrepancies: string[];
  /** source course id → existing target id when ids differ but names match. */
  courseRedirects: Map<string, string>;
  videoModes: { inherit: number; custom: number; none: number };
  sessionStats: { total: number; unexpired: number; expired: number; included: boolean };
};

/* ------------------------------ cli parsing ------------------------------- */

export class ImporterUsageError extends Error {}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let dbPath = DEFAULT_DB_PATH;
  let dryRun = false;
  let wipe = false;
  let includeSessions = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') throw new ImporterUsageError('help');
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--wipe') {
      wipe = true;
      continue;
    }
    if (arg === '--include-sessions') {
      includeSessions = true;
      continue;
    }
    if (arg === '--db') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new ImporterUsageError('--db 需要一个路径参数');
      dbPath = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--db=')) {
      const value = arg.slice('--db='.length);
      if (!value) throw new ImporterUsageError('--db 需要一个路径参数');
      dbPath = path.resolve(value);
      continue;
    }
    throw new ImporterUsageError(`未知参数：${arg}`);
  }

  const databaseUrl = String(env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) throw new ImporterUsageError('必须设置 DATABASE_URL（目标 PostgreSQL）');

  return { dbPath, dryRun, wipe, includeSessions, databaseUrl };
}

export const USAGE = `用法：import-sqlite.sh [选项]

把 v1 的 SQLite 数据库导入 v2 PostgreSQL。默认执行导入（upsert），请先用 --dry-run 校验。

选项：
  --db <path>          SQLite 源文件（默认：${DEFAULT_DB_PATH}）
  --dry-run            只校验并打印计数与差异，不写入数据库
  --wipe               导入前清空目标库中本导入器负责的表（危险）
  --include-sessions   同时导入未过期的 sessions/auth_tokens
  -h, --help           显示本帮助

环境变量：
  DATABASE_URL         目标 PostgreSQL 连接串（必填）
  MFA_ENC_KEY          MFA secret 加密密钥；生产环境必填，开发环境有固定回退

示例：
  DATABASE_URL=postgres://portal:portal@127.0.0.1:5433/ai_portal_test \\
    npm run import:sqlite -- --dry-run
  DATABASE_URL=postgres://portal:portal@127.0.0.1:5433/ai_portal_test \\
    npm run import:sqlite -- --wipe --include-sessions
`;

/* ------------------------------ sqlite reads ------------------------------ */

function requireNumber(value: unknown, field: string, issues: string[], context: string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  issues.push(`${context}: ${field} 不是数字（${JSON.stringify(value)}）`);
  return null;
}

function requireInteger(value: unknown, field: string, issues: string[], context: string): number | null {
  const num = requireNumber(value, field, issues, context);
  if (num === null) return null;
  if (!Number.isInteger(num)) {
    issues.push(`${context}: ${field} 必须是整数（${num}）`);
    return null;
  }
  return num;
}

function requireString(
  value: unknown,
  field: string,
  issues: string[],
  context: string,
  allowEmpty = false,
): string | null {
  if (typeof value !== 'string') {
    issues.push(`${context}: ${field} 不是字符串`);
    return null;
  }
  const text = allowEmpty ? value : value.trim();
  if (!allowEmpty && text === '') {
    issues.push(`${context}: ${field} 不能为空`);
    return null;
  }
  return text;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** `YYYY-MM-DD HH:MM:SS` (SQLite `datetime('now')`, UTC) or epoch ms → ISO. */
function parseTimestamp(
  value: unknown,
  field: string,
  issues: string[],
  context: string,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || typeof value === 'bigint') {
    const ms = Number(value);
    if (!Number.isFinite(ms)) {
      issues.push(`${context}: ${field} 时间戳无效（${String(value)}）`);
      return null;
    }
    return new Date(ms).toISOString();
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return new Date(Number(text)).toISOString();
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(text);
  if (match) {
    const [, day, clock, fraction] = match;
    const ms = fraction ? `.${fraction.padEnd(3, '0').slice(0, 3)}` : '';
    return `${day}T${clock}${ms}Z`;
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  issues.push(`${context}: ${field} 时间戳无法解析（${text}）`);
  return null;
}

function parseJson(value: unknown): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(String(value)) };
  } catch {
    return { ok: false };
  }
}

function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as SqliteRecord | undefined;
  const value = row?.n;
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

function readRows(db: DatabaseSync, table: string): SqliteRecord[] {
  return db.prepare(`SELECT * FROM "${table}"`).all() as unknown as SqliteRecord[];
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(table) as SqliteRecord | undefined;
  return Boolean(row?.ok);
}


function mapVideo(
  raw: unknown,
  courseId: string,
  issues: string[],
): {
  mode: 'inherit' | 'custom' | 'none';
  video: Record<string, unknown> | null;
} {
  if (raw === null || raw === undefined) return { mode: 'inherit', video: null };
  if (typeof raw !== 'string') {
    issues.push(`courses ${courseId}: video_json 不是字符串（${typeof raw}）`);
    return { mode: 'inherit', video: null };
  }
  const text = raw.trim();
  if (text === 'null') return { mode: 'none', video: null };
  if (text === '') {
    issues.push(`courses ${courseId}: video_json 为空字符串，按 inherit 处理`);
    return { mode: 'inherit', video: null };
  }
  const parsed = parseJson(text);
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    issues.push(`courses ${courseId}: video_json 不是对象，按 inherit 处理`);
    return { mode: 'inherit', video: null };
  }
  return { mode: 'custom', video: parsed.value as Record<string, unknown> };
}

/**
 * Read and validate the SQLite source. Never writes: `DatabaseSync` is opened
 * with `readOnly: true`.
 */
export function readSqliteSnapshot(dbPath: string, now: Date = new Date()): SourceSnapshot {
  if (!existsSync(dbPath)) throw new Error(`SQLite 源文件不存在：${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const issues: string[] = [];
  const sourceCounts = Object.fromEntries(TABLE_NAMES.map((name) => [name, 0])) as Record<
    TableName,
    number
  >;

  try {
    for (const name of TABLE_NAMES) {
      const sourceTable = SOURCE_TABLE[name];
      if (!tableExists(db, sourceTable)) {
        if (REQUIRED_SOURCE_TABLES.includes(name)) {
          throw new Error(`SQLite 缺少必需表：${sourceTable}`);
        }
        issues.push(`源库缺少可选表 ${sourceTable}，按 0 行处理`);
        continue;
      }
      sourceCounts[name] = countRows(db, sourceTable);
    }

    const users: ValidUser[] = [];
    const userEmails = new Set<string>();
    const userIds = new Set<number>();
    for (const row of readRows(db, 'users')) {
      const id = requireInteger(row.id, 'id', issues, 'users');
      if (id === null || id <= 0) continue;
      if (userIds.has(id)) {
        issues.push(`users id=${id}: 重复 id，跳过`);
        continue;
      }
      const rawEmail = requireString(row.email, 'email', issues, `users id=${id}`);
      if (rawEmail === null) continue;
      const email = rawEmail.toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        issues.push(`users id=${id}: 邮箱格式无效（${email}）`);
        continue;
      }
      if (userEmails.has(email)) {
        issues.push(`users id=${id}: 重复邮箱（${email}），跳过`);
        continue;
      }
      const name = requireString(row.name, 'name', issues, `users id=${id}`);
      const password_hash = requireString(row.password_hash, 'password_hash', issues, `users id=${id}`);
      if (name === null || password_hash === null) continue;
      const failed_attempts = requireInteger(
        row.failed_attempts ?? 0,
        'failed_attempts',
        issues,
        `users id=${id}`,
      );
      if (failed_attempts === null || failed_attempts < 0) continue;
      const created_at = parseTimestamp(row.created_at, 'created_at', issues, `users id=${id}`);
      if (created_at === null) continue;
      const role = USER_ROLES.has(String(row.role)) ? (String(row.role) as 'admin' | 'learner') : 'learner';
      if (!USER_ROLES.has(String(row.role))) {
        issues.push(`users id=${id}: role=${String(row.role)} 无效，按 learner 导入`);
      }
      const secret = optionalString(row.mfa_secret);
      userIds.add(id);
      userEmails.add(email);
      users.push({
        id,
        email,
        name,
        password_hash,
        role,
        active: toBoolean(row.active ?? 1),
        email_verified: toBoolean(row.email_verified ?? 1),
        failed_attempts,
        locked_until: parseTimestamp(row.locked_until, 'locked_until', issues, `users id=${id}`),
        mfa_secret: secret && secret.trim() !== '' ? secret : null,
        mfa_enabled: toBoolean(row.mfa_enabled ?? 0),
        created_at,
        last_login_at: parseTimestamp(row.last_login_at, 'last_login_at', issues, `users id=${id}`),
        hasMfaSecret: Boolean(secret && secret.trim() !== ''),
      });
    }

    const courses: ValidCourse[] = [];
    const courseIds = new Set<string>();
    const courseNames = new Set<string>();
    const videoModes = { inherit: 0, custom: 0, none: 0 };
    for (const row of readRows(db, 'courses')) {
      const id = requireString(row.id, 'id', issues, 'courses');
      if (id === null) continue;
      if (!COURSE_ID_PATTERN.test(id)) {
        issues.push(`courses ${id}: id 不符合 C<n> 格式，跳过`);
        continue;
      }
      if (courseIds.has(id)) {
        issues.push(`courses ${id}: 重复 id，跳过`);
        continue;
      }
      const name = requireString(row.name, 'name', issues, `courses ${id}`);
      if (name === null) continue;
      if (courseNames.has(name)) {
        issues.push(`courses ${id}: 重复课程名称（${name}），跳过`);
        continue;
      }
      const category = (requireString(row.category, 'category', issues, `courses ${id}`) || '未分类') as string;
      const teacher = (requireString(row.teacher, 'teacher', issues, `courses ${id}`) || '待定') as string;
      const level = (requireString(row.level, 'level', issues, `courses ${id}`) || '入门') as string;
      const sortOrder = requireInteger(row.sort_order ?? 0, 'sort_order', issues, `courses ${id}`);
      if (sortOrder === null) continue;
      let color = optionalString(row.color);
      if (color !== null && !HEX_COLOR_PATTERN.test(color)) {
        issues.push(`courses ${id}: color=${color} 不是 #RRGGBB，按 null 导入`);
        color = null;
      }
      const video = mapVideo(row.video_json, id, issues);
      videoModes[video.mode] += 1;
      const chaptersJson = optionalString(row.chapters_json);
      courseIds.add(id);
      courseNames.add(name);
      courses.push({
        id,
        name,
        category,
        teacher,
        level,
        badge: optionalString(row.badge),
        color,
        intro: optionalString(row.intro),
        video_mode: video.mode,
        video: video.video,
        sort_order: sortOrder,
        legacy_chapters: chaptersJson,
      });
    }

    const courseById = new Map(courses.map((course) => [course.id, course]));
    const courseByName = new Map(courses.map((course) => [course.name, course]));

    const chapters: ValidChapter[] = [];
    const chapterKeys = new Set<string>();
    for (const row of readRows(db, 'chapters')) {
      const course_id = requireString(row.course_id, 'course_id', issues, 'chapters');
      if (course_id === null) continue;
      if (!courseById.has(course_id)) {
        issues.push(`chapters course_id=${course_id}: 源课程不存在，跳过`);
        continue;
      }
      const idx = requireInteger(row.idx, 'idx', issues, `chapters ${course_id}`);
      if (idx === null || idx <= 0) continue;
      const title = requireString(row.title, 'title', issues, `chapters ${course_id}#${idx}`);
      const body = requireString(row.body, 'body', issues, `chapters ${course_id}#${idx}`, true);
      if (title === null || body === null) continue;
      const key = `${course_id}::${idx}`;
      if (chapterKeys.has(key)) {
        issues.push(`chapters ${course_id}#${idx}: 重复主键，跳过`);
        continue;
      }
      chapterKeys.add(key);
      chapters.push({ course_id, idx, title, body });
    }

    const knowledge: ValidKnowledge[] = [];
    const knowledgeKeys = new Set<string>();
    for (const row of readRows(db, 'knowledge')) {
      const course_id = requireString(row.course_id, 'course_id', issues, 'knowledge');
      if (course_id === null || !courseById.has(course_id)) {
        if (course_id !== null) issues.push(`knowledge course_id=${course_id}: 源课程不存在，跳过`);
        continue;
      }
      if (knowledgeKeys.has(course_id)) {
        issues.push(`knowledge course_id=${course_id}: 重复主键，跳过`);
        continue;
      }
      const parsed = parseJson(row.payload_json);
      if (!parsed.ok) {
        issues.push(`knowledge course_id=${course_id}: payload_json 不是合法 JSON，跳过`);
        continue;
      }
      if (typeof parsed.value !== 'object' || parsed.value === null) {
        issues.push(`knowledge course_id=${course_id}: payload 不是对象，按原值导入`);
      }
      knowledgeKeys.add(course_id);
      knowledge.push({ course_id, payload: parsed.value });
    }

    const records: ValidRecord[] = [];
    const recordIds = new Set<number>();
    for (const row of readRows(db, 'records')) {
      const id = requireInteger(row.id, 'id', issues, 'records');
      if (id === null || id <= 0) continue;
      if (recordIds.has(id)) {
        issues.push(`records id=${id}: 重复 id，跳过`);
        continue;
      }
      const student_id = requireString(row.student_id, 'student_id', issues, `records id=${id}`);
      if (student_id === null || student_id.length > 32) {
        if (student_id !== null) issues.push(`records id=${id}: student_id 超过 32 字符，跳过`);
        continue;
      }
      const courseName = requireString(row.course_name, 'course_name', issues, `records id=${id}`);
      if (courseName === null) continue;
      const course = courseByName.get(courseName);
      if (!course) {
        issues.push(`records id=${id}: 未知课程「${courseName}」，跳过`);
        continue;
      }
      const learning_date = requireString(row.learning_date, 'learning_date', issues, `records id=${id}`);
      if (learning_date === null || !isCalendarDate(learning_date)) {
        if (learning_date !== null) {
          issues.push(`records id=${id}: learning_date=${learning_date} 不是合法日历日期，跳过`);
        }
        continue;
      }
      const learning_minutes = requireInteger(
        row.learning_minutes,
        'learning_minutes',
        issues,
        `records id=${id}`,
      );
      const chapters_done = requireInteger(row.chapters_done, 'chapters_done', issues, `records id=${id}`);
      const total_chapters = requireInteger(row.total_chapters, 'total_chapters', issues, `records id=${id}`);
      if (learning_minutes === null || chapters_done === null || total_chapters === null) continue;
      if (learning_minutes < 0 || learning_minutes > 1440) {
        issues.push(`records id=${id}: learning_minutes=${learning_minutes} 超出 0..1440，跳过`);
        continue;
      }
      if (chapters_done < 0 || total_chapters <= 0 || chapters_done > total_chapters) {
        issues.push(
          `records id=${id}: chapters_done=${chapters_done}/total_chapters=${total_chapters} 无效，跳过`,
        );
        continue;
      }
      let quiz_score: number | null = null;
      if (row.quiz_score !== null && row.quiz_score !== undefined && row.quiz_score !== '') {
        quiz_score = requireNumber(row.quiz_score, 'quiz_score', issues, `records id=${id}`);
        if (quiz_score === null) continue;
        if (quiz_score < 0 || quiz_score > 100) {
          issues.push(`records id=${id}: quiz_score=${quiz_score} 超出 0..100，跳过`);
          continue;
        }
      }
      const created_at = parseTimestamp(row.created_at, 'created_at', issues, `records id=${id}`);
      if (created_at === null) continue;
      recordIds.add(id);
      records.push({
        id,
        student_id,
        course_id: course.id,
        course_name: courseName,
        learning_date,
        learning_minutes,
        chapters_done,
        total_chapters,
        quiz_score,
        created_at,
      });
    }

    const audit: ValidAudit[] = [];
    const auditIds = new Set<number>();
    for (const row of readRows(db, 'audit_log')) {
      const id = requireInteger(row.id, 'id', issues, 'audit_log');
      if (id === null || id <= 0) continue;
      if (auditIds.has(id)) {
        issues.push(`audit_log id=${id}: 重复 id，跳过`);
        continue;
      }
      const action = requireString(row.action, 'action', issues, `audit_log id=${id}`);
      const created_at = parseTimestamp(row.created_at, 'created_at', issues, `audit_log id=${id}`);
      if (action === null || created_at === null) continue;
      const actor_user_id =
        row.actor_user_id === null || row.actor_user_id === undefined
          ? null
          : requireInteger(row.actor_user_id, 'actor_user_id', issues, `audit_log id=${id}`);
      if (row.actor_user_id !== null && row.actor_user_id !== undefined && actor_user_id === null) {
        continue;
      }
      let details: unknown = null;
      if (row.details_json !== null && row.details_json !== undefined && row.details_json !== '') {
        const parsed = parseJson(row.details_json);
        if (!parsed.ok) {
          issues.push(`audit_log id=${id}: details_json 不是合法 JSON，details 置空`);
        } else {
          details = parsed.value;
        }
      }
      auditIds.add(id);
      audit.push({
        id,
        created_at,
        actor_user_id,
        actor_email: optionalString(row.actor_email),
        action,
        target_type: optionalString(row.target_type),
        target_id: optionalString(row.target_id),
        ip: optionalString(row.ip),
        details,
      });
    }

    const recovery: ValidRecovery[] = [];
    const recoveryIds = new Set<number>();
    for (const row of readRows(db, 'mfa_recovery_codes')) {
      const id = requireInteger(row.id, 'id', issues, 'mfa_recovery_codes');
      if (id === null || id <= 0) continue;
      if (recoveryIds.has(id)) {
        issues.push(`mfa_recovery_codes id=${id}: 重复 id，跳过`);
        continue;
      }
      const user_id = requireInteger(row.user_id, 'user_id', issues, `mfa_recovery_codes id=${id}`);
      if (user_id === null || !userIds.has(user_id)) {
        if (user_id !== null) {
          issues.push(`mfa_recovery_codes id=${id}: 用户 ${user_id} 不存在，跳过`);
        }
        continue;
      }
      const code_hash = requireString(row.code_hash, 'code_hash', issues, `mfa_recovery_codes id=${id}`);
      const created_at = parseTimestamp(
        row.created_at,
        'created_at',
        issues,
        `mfa_recovery_codes id=${id}`,
      );
      if (code_hash === null || created_at === null) continue;
      recoveryIds.add(id);
      recovery.push({
        id,
        user_id,
        code_hash,
        used_at: parseTimestamp(row.used_at, 'used_at', issues, `mfa_recovery_codes id=${id}`),
        created_at,
      });
    }

    const sessions: ValidSession[] = [];
    const sessionIds = new Set<string>();
    const nowMs = now.getTime();
    for (const row of readRows(db, 'sessions')) {
      const id = requireString(row.id, 'id', issues, 'sessions');
      if (id === null) continue;
      if (sessionIds.has(id)) {
        issues.push(`sessions id=${id}: 重复 id，跳过`);
        continue;
      }
      const user_id = requireInteger(row.user_id, 'user_id', issues, `sessions id=${id}`);
      if (user_id === null || !userIds.has(user_id)) {
        if (user_id !== null) issues.push(`sessions id=${id}: 用户 ${user_id} 不存在，跳过`);
        continue;
      }
      const expires_at = parseTimestamp(row.expires_at, 'expires_at', issues, `sessions id=${id}`);
      const created_at = parseTimestamp(row.created_at, 'created_at', issues, `sessions id=${id}`);
      if (expires_at === null || created_at === null) continue;
      if (Date.parse(expires_at) <= nowMs) {
        issues.push(`sessions id=${id}: 已过期，跳过`);
        continue;
      }
      sessionIds.add(id);
      sessions.push({ id, user_id, expires_at, created_at });
    }

    const authTokens: ValidAuthToken[] = [];
    const tokenIds = new Set<string>();
    for (const row of readRows(db, 'auth_tokens')) {
      const id = requireString(row.id, 'id', issues, 'auth_tokens');
      if (id === null) continue;
      if (tokenIds.has(id)) {
        issues.push(`auth_tokens id=${id}: 重复 id，跳过`);
        continue;
      }
      const user_id = requireInteger(row.user_id, 'user_id', issues, `auth_tokens id=${id}`);
      if (user_id === null || !userIds.has(user_id)) {
        if (user_id !== null) issues.push(`auth_tokens id=${id}: 用户 ${user_id} 不存在，跳过`);
        continue;
      }
      const type = String(row.type);
      if (!TOKEN_TYPES.has(type)) {
        issues.push(`auth_tokens id=${id}: type=${type} 无效，跳过`);
        continue;
      }
      const expires_at = parseTimestamp(row.expires_at, 'expires_at', issues, `auth_tokens id=${id}`);
      const created_at = parseTimestamp(row.created_at, 'created_at', issues, `auth_tokens id=${id}`);
      if (expires_at === null || created_at === null) continue;
      if (Date.parse(expires_at) <= nowMs) {
        issues.push(`auth_tokens id=${id}: 已过期，跳过`);
        continue;
      }
      tokenIds.add(id);
      authTokens.push({
        id,
        user_id,
        type: type as 'verify' | 'reset' | 'mfa',
        expires_at,
        used_at: parseTimestamp(row.used_at, 'used_at', issues, `auth_tokens id=${id}`),
        created_at,
      });
    }

    const meta: ValidMeta[] = [];
    const metaKeys = new Set<string>();
    for (const row of readRows(db, SOURCE_TABLE.app_meta)) {
      const key = requireString(row.key, 'key', issues, 'meta');
      if (key === null) continue;
      if (metaKeys.has(key)) {
        issues.push(`meta ${key}: 重复 key，跳过`);
        continue;
      }
      metaKeys.add(key);
      meta.push({ key, value: optionalString(row.value) });
    }

    return {
      path: dbPath,
      users,
      courses,
      chapters,
      knowledge,
      records,
      audit,
      recovery,
      sessions,
      authTokens,
      meta,
      sourceCounts,
      issues,
      videoModes,
      sessionsTotal: sourceCounts.sessions,
    };
  } finally {
    db.close();
  }
}

/* ------------------------- target state / planning ------------------------ */

function targetDatabaseName(connectionString: string): string {
  try {
    return new URL(connectionString).pathname.replace(/^\//, '') || '(unknown)';
  } catch {
    return '(unparsable DATABASE_URL)';
  }
}

async function readTargetState(client: Client): Promise<TargetState> {
  const counts = Object.fromEntries(TABLE_NAMES.map((name) => [name, 0])) as Record<TableName, number>;
  for (const name of TABLE_NAMES) {
    const { rows } = await client.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${name}"`);
    counts[name] = Number(rows[0]?.n ?? 0);
  }
  const courseRows = await client.query<{ id: string; name: string }>('SELECT id, name FROM courses');
  const courseIdsByName = new Map<string, string>();
  const courseNamesById = new Map<string, string>();
  for (const row of courseRows.rows) {
    courseIdsByName.set(row.name, row.id);
    courseNamesById.set(row.id, row.name);
  }
  const userRows = await client.query<{ id: number; email: string }>('SELECT id, email FROM users');
  const userIdsByEmail = new Map<string, number>();
  for (const row of userRows.rows) userIdsByEmail.set(String(row.email).toLowerCase(), row.id);
  return { counts, courseIdsByName, courseNamesById, userIdsByEmail };
}

export function buildPlan(
  source: SourceSnapshot,
  target: TargetState,
  options: { includeSessions: boolean },
): ImportPlan {
  const issues = [...source.issues];
  const discrepancies: string[] = [];
  const courseRedirects = new Map<string, string>();

  // Users: an existing target email owned by a different id cannot be
  // overwritten without breaking foreign keys. Skip those rows.
  const users: ValidUser[] = [];
  for (const user of source.users) {
    const existingId = target.userIdsByEmail.get(user.email);
    if (existingId !== undefined && existingId !== user.id) {
      discrepancies.push(
        `users id=${user.id}: 目标库邮箱 ${user.email} 属于 id=${existingId}，跳过（不覆盖已有账号）`,
      );
      continue;
    }
    users.push(user);
  }
  const importedUserIds = new Set(users.map((user) => user.id));

  // Courses: same name at a different id → map dependants onto the target id.
  const courses: ValidCourse[] = [];
  for (const course of source.courses) {
    const existingId = target.courseIdsByName.get(course.name);
    if (existingId !== undefined && existingId !== course.id) {
      courseRedirects.set(course.id, existingId);
      discrepancies.push(
        `courses ${course.id}: 目标库同名课程「${course.name}」为 ${existingId}，跳过本行并复用目标 id`,
      );
      continue;
    }
    const existingName = target.courseNamesById.get(course.id);
    if (existingName !== undefined && existingName !== course.name) {
      discrepancies.push(
        `courses ${course.id}: 目标库同 id 课程名为「${existingName}」，将更新为「${course.name}」`,
      );
    }
    courses.push(course);
  }

  const courseIdMap = new Map<string, string>();
  for (const course of source.courses) {
    const redirect = courseRedirects.get(course.id);
    courseIdMap.set(course.id, redirect ?? course.id);
  }
  for (const course of courses) courseIdMap.set(course.id, course.id);

  const chapters = source.chapters.map((chapter) => ({
    ...chapter,
    course_id: courseIdMap.get(chapter.course_id) ?? chapter.course_id,
  }));
  const knowledge = source.knowledge.map((entry) => ({
    ...entry,
    course_id: courseIdMap.get(entry.course_id) ?? entry.course_id,
  }));
  const records = source.records.map((record) => ({
    ...record,
    course_id: courseIdMap.get(record.course_id) ?? record.course_id,
  }));

  const audit = source.audit.map((entry) => {
    if (entry.actor_user_id !== null && !importedUserIds.has(entry.actor_user_id)) {
      discrepancies.push(
        `audit_log id=${entry.id}: actor_user_id=${entry.actor_user_id} 未导入，置为 null`,
      );
      return { ...entry, actor_user_id: null };
    }
    return entry;
  });

  const recovery = source.recovery.filter((entry) => {
    if (importedUserIds.has(entry.user_id)) return true;
    discrepancies.push(`mfa_recovery_codes id=${entry.id}: 用户 ${entry.user_id} 未导入，跳过`);
    return false;
  });

  const sessions = options.includeSessions
    ? source.sessions.filter((entry) => {
        if (importedUserIds.has(entry.user_id)) return true;
        discrepancies.push(`sessions id=${entry.id}: 用户 ${entry.user_id} 未导入，跳过`);
        return false;
      })
    : [];
  const authTokens = options.includeSessions
    ? source.authTokens.filter((entry) => {
        if (importedUserIds.has(entry.user_id)) return true;
        discrepancies.push(`auth_tokens id=${entry.id}: 用户 ${entry.user_id} 未导入，跳过`);
        return false;
      })
    : [];

  const sessionsUnexpired = source.sessions.length;
  const sessionsExpired = source.sessionsTotal - sessionsUnexpired;

  const skipped: Record<TableName, number> = {
    users: source.sourceCounts.users - users.length,
    courses: source.sourceCounts.courses - courses.length,
    chapters: source.sourceCounts.chapters - chapters.length,
    knowledge: source.sourceCounts.knowledge - knowledge.length,
    records: source.sourceCounts.records - records.length,
    audit_log: source.sourceCounts.audit_log - audit.length,
    mfa_recovery_codes: source.sourceCounts.mfa_recovery_codes - recovery.length,
    sessions: source.sourceCounts.sessions - sessions.length,
    auth_tokens: source.sourceCounts.auth_tokens - authTokens.length,
    app_meta: source.sourceCounts.app_meta - source.meta.length,
  };

  if (!options.includeSessions && source.sessionsTotal > 0) {
    discrepancies.push(
      `sessions: 源库 ${source.sessionsTotal} 行未导入（默认跳过，使用 --include-sessions 只导入未过期会话）`,
    );
  }
  if (!options.includeSessions && source.authTokens.length > 0) {
    discrepancies.push(
      `auth_tokens: 源库 ${source.authTokens.length} 行未导入（默认跳过，使用 --include-sessions）`,
    );
  }
  if (sessionsExpired > 0) {
    discrepancies.push(`sessions: ${sessionsExpired} 行已过期，即使 --include-sessions 也不导入`);
  }
  for (const table of TABLE_NAMES) {
    if (target.counts[table] > 0) {
      discrepancies.push(
        `target ${table}: 已有 ${target.counts[table]} 行；未使用 --wipe 时导入采用 upsert，不会删除目标库额外数据`,
      );
    }
  }

  return {
    users,
    courses,
    chapters,
    knowledge,
    records,
    audit,
    recovery,
    sessions,
    authTokens,
    meta: source.meta,
    skipped,
    issues,
    discrepancies,
    courseRedirects,
    videoModes: source.videoModes,
    sessionStats: {
      total: source.sessionsTotal,
      unexpired: sessionsUnexpired,
      expired: sessionsExpired,
      included: options.includeSessions,
    },
  };
}

/* ------------------------------- apply stage ------------------------------ */

function currentMfaKey(): Buffer {
  const appEnv = String(process.env.APP_ENV ?? 'development').trim();
  const nodeEnv = String(process.env.NODE_ENV ?? '').trim();
  const production = appEnv === 'production' || nodeEnv === 'production';
  let source = String(process.env.MFA_ENC_KEY ?? '').trim();
  if (!source) {
    if (production) throw new Error('生产环境必须设置 MFA_ENC_KEY，无法加密 v1 MFA secret');
    source = DEV_MFA_KEY_SEED;
  }
  return deriveMfaKey(source);
}

async function wipeTarget(client: Client): Promise<void> {
  await client.query(
    `TRUNCATE TABLE records, chapters, knowledge, courses, mfa_recovery_codes,
       auth_tokens, sessions, audit_log, users, app_meta RESTART IDENTITY CASCADE`,
  );
}

async function insertUsers(client: Client, rows: ValidUser[], key: Buffer): Promise<void> {
  const sql = `INSERT INTO users
    (id, email, name, password_hash, role, active, email_verified, failed_attempts,
     locked_until, mfa_secret, mfa_enabled, created_at, last_login_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET
      email = excluded.email, name = excluded.name, password_hash = excluded.password_hash,
      role = excluded.role, active = excluded.active, email_verified = excluded.email_verified,
      failed_attempts = excluded.failed_attempts, locked_until = excluded.locked_until,
      mfa_secret = excluded.mfa_secret, mfa_enabled = excluded.mfa_enabled,
      created_at = excluded.created_at, last_login_at = excluded.last_login_at`;
  for (const row of rows) {
    const secret =
      row.mfa_secret === null
        ? null
        : row.hasMfaSecret
          ? encryptSecret(row.mfa_secret, key)
          : row.mfa_secret;
    await client.query(sql, [
      row.id,
      row.email,
      row.name,
      row.password_hash,
      row.role,
      row.active,
      row.email_verified,
      row.failed_attempts,
      row.locked_until,
      secret,
      row.mfa_enabled,
      row.created_at,
      row.last_login_at,
    ]);
  }
}

async function insertCourses(client: Client, rows: ValidCourse[]): Promise<void> {
  const sql = `INSERT INTO courses
    (id, name, category, teacher, level, badge, color, intro, video_mode, video, sort_order)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, category = excluded.category, teacher = excluded.teacher,
      level = excluded.level, badge = excluded.badge, color = excluded.color,
      intro = excluded.intro, video_mode = excluded.video_mode, video = excluded.video,
      sort_order = excluded.sort_order`;
  for (const row of rows) {
    await client.query(sql, [
      row.id,
      row.name,
      row.category,
      row.teacher,
      row.level,
      row.badge,
      row.color,
      row.intro,
      row.video_mode,
      row.video === null ? null : JSON.stringify(row.video),
      row.sort_order,
    ]);
  }
}

async function insertChapters(client: Client, rows: ValidChapter[]): Promise<void> {
  const sql = `INSERT INTO chapters (course_id, idx, title, body)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (course_id, idx) DO UPDATE SET title = excluded.title, body = excluded.body`;
  for (const row of rows) await client.query(sql, [row.course_id, row.idx, row.title, row.body]);
}

async function insertKnowledge(client: Client, rows: ValidKnowledge[]): Promise<void> {
  const sql = `INSERT INTO knowledge (course_id, payload) VALUES ($1, $2::jsonb)
    ON CONFLICT (course_id) DO UPDATE SET payload = excluded.payload`;
  for (const row of rows) {
    await client.query(sql, [row.course_id, JSON.stringify(row.payload)]);
  }
}

async function insertRecords(client: Client, rows: ValidRecord[]): Promise<void> {
  const sql = `INSERT INTO records
    (id, student_id, course_id, learning_date, learning_minutes, chapters_done,
     total_chapters, quiz_score, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET
      student_id = excluded.student_id, course_id = excluded.course_id,
      learning_date = excluded.learning_date, learning_minutes = excluded.learning_minutes,
      chapters_done = excluded.chapters_done, total_chapters = excluded.total_chapters,
      quiz_score = excluded.quiz_score, created_at = excluded.created_at`;
  for (const row of rows) {
    await client.query(sql, [
      row.id,
      row.student_id,
      row.course_id,
      row.learning_date,
      row.learning_minutes,
      row.chapters_done,
      row.total_chapters,
      row.quiz_score,
      row.created_at,
    ]);
  }
}

async function insertAudit(client: Client, rows: ValidAudit[]): Promise<void> {
  const sql = `INSERT INTO audit_log
    (id, created_at, actor_user_id, actor_email, action, target_type, target_id, ip, details)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      created_at = excluded.created_at, actor_user_id = excluded.actor_user_id,
      actor_email = excluded.actor_email, action = excluded.action,
      target_type = excluded.target_type, target_id = excluded.target_id,
      ip = excluded.ip, details = excluded.details`;
  for (const row of rows) {
    await client.query(sql, [
      row.id,
      row.created_at,
      row.actor_user_id,
      row.actor_email,
      row.action,
      row.target_type,
      row.target_id,
      row.ip,
      row.details === null ? null : JSON.stringify(row.details),
    ]);
  }
}

async function insertRecovery(client: Client, rows: ValidRecovery[]): Promise<void> {
  const sql = `INSERT INTO mfa_recovery_codes (id, user_id, code_hash, used_at, created_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET
      user_id = excluded.user_id, code_hash = excluded.code_hash,
      used_at = excluded.used_at, created_at = excluded.created_at`;
  for (const row of rows) {
    await client.query(sql, [row.id, row.user_id, row.code_hash, row.used_at, row.created_at]);
  }
}

async function insertSessions(client: Client, rows: ValidSession[]): Promise<void> {
  const sql = `INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET
      user_id = excluded.user_id, expires_at = excluded.expires_at,
      created_at = excluded.created_at`;
  for (const row of rows) {
    await client.query(sql, [row.id, row.user_id, row.expires_at, row.created_at]);
  }
}

async function insertAuthTokens(client: Client, rows: ValidAuthToken[]): Promise<void> {
  const sql = `INSERT INTO auth_tokens (id, user_id, type, expires_at, used_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      user_id = excluded.user_id, type = excluded.type, expires_at = excluded.expires_at,
      used_at = excluded.used_at, created_at = excluded.created_at`;
  for (const row of rows) {
    await client.query(sql, [
      row.id,
      row.user_id,
      row.type,
      row.expires_at,
      row.used_at,
      row.created_at,
    ]);
  }
}

async function upsertMeta(client: Client, key: string, value: string | number | null): Promise<void> {
  await client.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value === null ? null : String(value)],
  );
}

async function insertMeta(client: Client, rows: ValidMeta[]): Promise<void> {
  for (const row of rows) await upsertMeta(client, row.key, row.value);
}

async function alignSequences(client: Client, plan: ImportPlan): Promise<ImportReport['sequences']> {
  for (const { table, column } of IDENTITY_SEQUENCES) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', '${column}'),
        COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`,
    );
  }

  const { rows: maxCourseRows } = await client.query<{ max_id: string }>(
    `SELECT COALESCE(MAX((nullif(regexp_replace(id, '[^0-9]', '', 'g'), ''))::int), 0)::text AS max_id
     FROM courses`,
  );
  const maxCourse = Number(maxCourseRows[0]?.max_id ?? 0);
  const { rows: legacyRows } = await client.query<{ value: string | null }>(
    "SELECT value FROM app_meta WHERE key = 'course_seq'",
  );
  const legacy = Number.parseInt(legacyRows[0]?.value ?? '', 10);
  const { rows: seqRows } = await client.query<{ last_value: string }>(
    'SELECT last_value::text AS last_value FROM course_seq',
  );
  const seqLast = Number.parseInt(seqRows[0]?.last_value ?? '', 10);
  const courseTarget = Math.max(
    maxCourse,
    Number.isFinite(legacy) ? legacy : 0,
    Number.isFinite(seqLast) ? seqLast : 0,
    1,
  );
  await client.query("SELECT setval('course_seq', $1, true)", [courseTarget]);
  await upsertMeta(client, 'course_seq', courseTarget);

  // Keep the v1 seed flags so a later start-up never replays the catalogue or
  // chapter import over migrated data.
  const { rows: flagRows } = await client.query<{ key: string }>('SELECT key FROM app_meta');
  const existingKeys = new Set(flagRows.map((row) => row.key));
  if (!existingKeys.has('catalog_seeded')) await upsertMeta(client, 'catalog_seeded', '1');
  const finalCourseIds = new Set([
    ...plan.courses.map((course) => course.id),
    ...plan.courseRedirects.values(),
  ]);
  for (const courseId of finalCourseIds) {
    const key = `chapters_seeded_${courseId}`;
    if (!existingKeys.has(key)) await upsertMeta(client, key, '1');
  }

  // Preserve the v1 chapter title list that no longer has a column in v2.
  for (const course of plan.courses) {
    if (course.legacy_chapters !== null) {
      await upsertMeta(client, `legacy_chapters_${course.id}`, course.legacy_chapters);
    }
  }

  const { rows: seqState } = await client.query<{
    course: string;
    users: string;
    records: string;
    audit_log: string;
    mfa_recovery_codes: string;
  }>(`SELECT
    (SELECT last_value FROM course_seq)::text AS course,
    (SELECT last_value FROM users_id_seq)::text AS users,
    (SELECT last_value FROM records_id_seq)::text AS records,
    (SELECT last_value FROM audit_log_id_seq)::text AS audit_log,
    (SELECT last_value FROM mfa_recovery_codes_id_seq)::text AS mfa_recovery_codes`);
  const row = seqState[0];
  return {
    course: Number(row?.course ?? 0),
    users: Number(row?.users ?? 0),
    records: Number(row?.records ?? 0),
    auditLog: Number(row?.audit_log ?? 0),
    mfaRecoveryCodes: Number(row?.mfa_recovery_codes ?? 0),
  };
}

async function readTargetCounts(client: Client): Promise<Record<TableName, number>> {
  const counts = Object.fromEntries(TABLE_NAMES.map((name) => [name, 0])) as Record<TableName, number>;
  for (const name of TABLE_NAMES) {
    const { rows } = await client.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${name}"`);
    counts[name] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

/* ------------------------------- reporting -------------------------------- */

function goldenFromRecords(records: readonly ValidRecord[]): GoldenMetrics {
  const learning: LearningRecord[] = records.map((record) => ({
    student_id: record.student_id,
    course_name: record.course_name,
    learning_date: record.learning_date,
    learning_minutes: record.learning_minutes,
    chapters_done: record.chapters_done,
    total_chapters: record.total_chapters,
    quiz_score: record.quiz_score,
  }));
  const enrollments = groupEnrollments(learning);
  const overview = summarize(learning, enrollments);
  return {
    students: overview.students,
    courses: overview.courses,
    enrollments: overview.enrollments,
    records: overview.records,
    avgCompletion: overview.avgCompletion,
    avgScore: overview.avgScore,
    noScoreEnrollments: overview.noScoreEnrollments,
    totalHours: overview.totalHours,
  };
}

function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(unparsable DATABASE_URL)';
  }
}

export function formatReport(report: ImportReport): string {
  const lines: string[] = [];
  lines.push(`[import] source: ${report.dbPath}`);
  lines.push(`[import] target: ${redact(report.targetDatabase)} (database=${targetDatabaseName(report.targetDatabase)})`);
  lines.push(`[import] mode:   ${report.mode}${report.wipe ? ' (wipe)' : ''}`);
  lines.push('');
  lines.push('[import] table                 source  valid  skipped  before  after');
  for (const table of TABLE_NAMES) {
    const count = report.counts[table];
    lines.push(
      `[import] ${table.padEnd(20)} ${String(count.source).padStart(6)} ${String(count.valid).padStart(6)} ${String(
        count.skipped,
      ).padStart(8)} ${String(count.targetBefore).padStart(7)} ${String(count.targetAfter ?? '-').padStart(6)}`,
    );
  }
  lines.push('');
  lines.push(
    `[import] video modes: inherit=${report.videoModes.inherit} custom=${report.videoModes.custom} none=${report.videoModes.none}`,
  );
  lines.push(
    `[import] sessions: total=${report.sessions.total} unexpired=${report.sessions.unexpired} expired=${report.sessions.expired} included=${report.sessions.included}`,
  );
  const g = report.golden;
  lines.push(
    `[import] golden: students=${g.students} courses=${g.courses} enrollments=${g.enrollments} completion=${String(
      g.avgCompletion,
    )} avgScore=${String(g.avgScore)} noScore=${g.noScoreEnrollments} hours=${String(g.totalHours)}`,
  );
  lines.push(
    `[import] sequences: course=${report.sequences.course} users=${report.sequences.users} records=${report.sequences.records} audit=${report.sequences.auditLog} recovery=${report.sequences.mfaRecoveryCodes}`,
  );
  if (report.issues.length > 0) {
    lines.push('');
    lines.push(`[import] validation issues (${report.issues.length}):`);
    for (const issue of report.issues.slice(0, 50)) lines.push(`  - ${issue}`);
    if (report.issues.length > 50) lines.push(`  ... 另有 ${report.issues.length - 50} 条未显示`);
  }
  if (report.discrepancies.length > 0) {
    lines.push('');
    lines.push(`[import] discrepancies (${report.discrepancies.length}):`);
    for (const item of report.discrepancies.slice(0, 50)) lines.push(`  - ${item}`);
    if (report.discrepancies.length > 50) lines.push(`  ... 另有 ${report.discrepancies.length - 50} 条未显示`);
  }
  lines.push('');
  if (report.mode === 'dry-run') {
    lines.push('[import] dry-run: no data written.');
  } else {
    lines.push('[import] import committed.');
  }
  return lines.join('\n');
}

/* -------------------------------- entrypoint ------------------------------ */

export async function importSqlite(options: ImportOptions): Promise<ImportReport> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('必须设置 DATABASE_URL（目标 PostgreSQL）');
  const dryRun = options.dryRun ?? false;
  const wipe = options.wipe ?? false;
  const includeSessions = options.includeSessions ?? false;
  const source = readSqliteSnapshot(options.dbPath, options.now ?? new Date());

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    let target: TargetState;
    try {
      target = await readTargetState(client);
    } catch (error) {
      throw new Error(
        `无法读取目标库（请先执行 npm run db:migrate）：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const plan = buildPlan(source, target, { includeSessions });
    const counts = Object.fromEntries(
      TABLE_NAMES.map((table) => [table, {
        source: source.sourceCounts[table],
        valid: 0,
        skipped: plan.skipped[table],
        targetBefore: target.counts[table],
        targetAfter: null,
      }]),
    ) as Record<TableName, TableImportCount>;
    const validRows: Record<TableName, readonly unknown[]> = {
      users: plan.users,
      courses: plan.courses,
      chapters: plan.chapters,
      knowledge: plan.knowledge,
      records: plan.records,
      audit_log: plan.audit,
      mfa_recovery_codes: plan.recovery,
      sessions: plan.sessions,
      auth_tokens: plan.authTokens,
      app_meta: plan.meta,
    };
    for (const table of TABLE_NAMES) counts[table].valid = validRows[table].length;

    const golden = goldenFromRecords(plan.records);
    let sequences: ImportReport['sequences'] = {
      course: plan.courses.length,
      users: plan.users.length,
      records: plan.records.length,
      auditLog: plan.audit.length,
      mfaRecoveryCodes: plan.recovery.length,
    };

    if (!dryRun) {
      await client.query('BEGIN');
      try {
        if (wipe) await wipeTarget(client);
        await insertUsers(client, plan.users, currentMfaKey());
        await insertCourses(client, plan.courses);
        await insertChapters(client, plan.chapters);
        await insertKnowledge(client, plan.knowledge);
        await insertRecords(client, plan.records);
        await insertAudit(client, plan.audit);
        await insertRecovery(client, plan.recovery);
        await insertSessions(client, plan.sessions);
        await insertAuthTokens(client, plan.authTokens);
        await insertMeta(client, plan.meta);
        sequences = await alignSequences(client, plan);
        const after = await readTargetCounts(client);
        for (const table of TABLE_NAMES) counts[table].targetAfter = after[table];
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }

    return {
      mode: dryRun ? 'dry-run' : 'apply',
      dbPath: source.path,
      targetDatabase: databaseUrl,
      wipe,
      includeSessions,
      counts,
      issues: plan.issues,
      discrepancies: plan.discrepancies,
      videoModes: plan.videoModes,
      sessions: plan.sessionStats,
      golden,
      sequences,
    };
  } finally {
    await client.end();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    if (!existsSync(options.dbPath)) {
      console.error(`[import] 源文件不存在：${options.dbPath}`);
      return 1;
    }
    const report = await importSqlite({
      dbPath: options.dbPath,
      databaseUrl: options.databaseUrl,
      dryRun: options.dryRun,
      wipe: options.wipe,
      includeSessions: options.includeSessions,
    });
    console.log(formatReport(report));
    return 0;
  } catch (error) {
    if (error instanceof ImporterUsageError) {
      if (error.message === 'help') {
        console.log(USAGE);
        return 0;
      }
      console.error(`[import] ${error.message}`);
      console.error('');
      console.error(USAGE);
      return 2;
    }
    console.error(`[import] failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}