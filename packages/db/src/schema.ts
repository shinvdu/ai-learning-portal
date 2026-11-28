/**
 * Drizzle PostgreSQL schema for the AI Learning Portal v2.
 *
 * Column names are kept identical to the SQL identifiers (snake_case) so raw
 * SQL, the `records_with_course_name` view and Drizzle results expose the same
 * field names. See docs/ARCHITECTURE_V2.md section 2.5 and ADR-003/007/008.
 *
 * The authoritative DDL lives in `packages/db/drizzle/0001_initial.sql`; this
 * module must stay in lockstep with it.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  pgView,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* --------------------------------- types --------------------------------- */

/** Postgres `citext` for case-insensitive email uniqueness. */
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/** Stored video configuration (jsonb). Shape mirrors the v1 course content. */
export type CourseVideo = {
  src: string;
  poster?: string;
  duration?: string;
  durationText?: string;
  label?: string;
  note?: string;
  isPlaceholder?: boolean;
};

/** Allowed user roles. */
export const userRoleValues = ['admin', 'learner'] as const;
export type UserRole = (typeof userRoleValues)[number];

/**
 * Single-use token purposes. Values intentionally match the v1 auth module so
 * existing flows keep working without a data translation.
 */
export const authTokenTypeValues = ['verify', 'reset', 'mfa'] as const;
export type AuthTokenType = (typeof authTokenTypeValues)[number];

/**
 * Explicit video state (ADR-008):
 * - `inherit`: fall back to the seeded content configuration
 * - `custom`: admin supplied the object in `video`
 * - `none`: admin removed the video
 */
export const videoModeValues = ['inherit', 'custom', 'none'] as const;
export type VideoMode = (typeof videoModeValues)[number];

/* -------------------------------- enums ---------------------------------- */

export const userRole = pgEnum('user_role', userRoleValues);
export const authTokenType = pgEnum('auth_token_type', authTokenTypeValues);
export const videoMode = pgEnum('video_mode', videoModeValues);

/* ------------------------------- sequences ------------------------------- */

/** Monotonic `C{n}` allocator; seed code calls `setval` past existing ids. */
export const courseSeq = pgSequence('course_seq', { startWith: 1 });

/* --------------------------------- users --------------------------------- */

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: citext('email').notNull(),
    name: text('name').notNull(),
    password_hash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('learner'),
    active: boolean('active').notNull().default(true),
    email_verified: boolean('email_verified').notNull().default(true),
    failed_attempts: integer('failed_attempts').notNull().default(0),
    locked_until: timestamp('locked_until', { withTimezone: true }),
    mfa_secret: text('mfa_secret'),
    mfa_enabled: boolean('mfa_enabled').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    last_login_at: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    check('users_failed_attempts_non_negative', sql`${t.failed_attempts} >= 0`),
  ],
);

/* -------------------------------- sessions ------------------------------- */

export const sessions = pgTable(
  'sessions',
  {
    // SHA-256 of the random cookie token; the raw token is never stored.
    id: text('id').primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sessions_user').on(t.user_id),
    index('idx_sessions_expires').on(t.expires_at),
  ],
);

/* ------------------------------ auth tokens ------------------------------ */

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: text('id').primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: authTokenType('type').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    used_at: timestamp('used_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_auth_tokens_user').on(t.user_id, t.type),
    index('idx_auth_tokens_expires').on(t.expires_at),
  ],
);

/* --------------------------- mfa recovery codes -------------------------- */

export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: serial('id').primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code_hash: text('code_hash').notNull(),
    used_at: timestamp('used_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_recovery_user').on(t.user_id)],
);

/* -------------------------------- audit log ------------------------------ */

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actor_email: text('actor_email'),
    action: text('action').notNull(),
    target_type: text('target_type'),
    target_id: text('target_id'),
    ip: text('ip'),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('idx_audit_created').on(t.created_at),
    index('idx_audit_action').on(t.action),
    index('idx_audit_actor').on(t.actor_user_id),
  ],
);

/* -------------------------------- courses -------------------------------- */

export const courses = pgTable(
  'courses',
  {
    // `C1`, `C2`, ... allocated monotonically by `course_seq`.
    id: text('id')
      .primaryKey()
      .default(sql`'C' || nextval('course_seq')`),
    name: text('name').notNull(),
    category: text('category').notNull(),
    teacher: text('teacher').notNull(),
    level: text('level').notNull(),
    badge: text('badge'),
    color: text('color'),
    intro: text('intro'),
    video_mode: videoMode('video_mode').notNull().default('inherit'),
    video: jsonb('video').$type<CourseVideo>(),
    sort_order: integer('sort_order').notNull().default(0),
    // Numeric part of the id for stable ordering (`C2` before `C10`).
    id_num: integer('id_num').generatedAlwaysAs(
      sql`(nullif(regexp_replace(id, '[^0-9]', '', 'g'), ''))::integer`,
    ),
  },
  (t) => [
    uniqueIndex('courses_name_unique').on(t.name),
    index('idx_courses_sort').on(t.sort_order, t.id_num, t.id),
    check(
      'courses_video_mode_payload',
      sql`((${t.video_mode} = 'custom') = (${t.video} is not null))`,
    ),
    check('courses_color_format', sql`${t.color} is null or ${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

/* -------------------------------- chapters ------------------------------- */

export const chapters = pgTable(
  'chapters',
  {
    course_id: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
  },
  (t) => [primaryKey({ columns: [t.course_id, t.idx], name: 'chapters_pkey' })],
);

/* -------------------------------- knowledge ------------------------------ */

export const knowledge = pgTable('knowledge', {
  course_id: text('course_id')
    .primaryKey()
    .references(() => courses.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
});

/* --------------------------------- records ------------------------------- */

export const records = pgTable(
  'records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    student_id: text('student_id').notNull(),
    course_id: text('course_id').notNull(),
    learning_date: date('learning_date', { mode: 'string' }).notNull(),
    learning_minutes: integer('learning_minutes').notNull(),
    chapters_done: integer('chapters_done').notNull(),
    total_chapters: integer('total_chapters').notNull(),
    quiz_score: doublePrecision('quiz_score'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'records_course_id_fkey',
      columns: [t.course_id],
      foreignColumns: [courses.id],
    }).onDelete('restrict'),
    index('idx_records_course').on(t.course_id),
    index('idx_records_student').on(t.student_id),
    index('idx_records_date').on(t.learning_date),
    index('idx_records_listing').on(sql`${t.learning_date} desc`, t.student_id, t.id),
    check('records_student_id_length', sql`char_length(${t.student_id}) between 1 and 32`),
    check('records_learning_minutes_range', sql`${t.learning_minutes} between 0 and 1440`),
    check('records_chapters_done_non_negative', sql`${t.chapters_done} >= 0`),
    check('records_total_chapters_positive', sql`${t.total_chapters} > 0`),
    check('records_chapters_within_total', sql`${t.chapters_done} <= ${t.total_chapters}`),
    check(
      'records_quiz_score_range',
      sql`${t.quiz_score} is null or (${t.quiz_score} >= 0 and ${t.quiz_score} <= 100)`,
    ),
  ],
);

/* -------------------------------- app meta ------------------------------- */

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value'),
});

/* ---------------------------- dataset imports ---------------------------- */

export const datasetImports = pgTable(
  'dataset_imports',
  {
    id: serial('id').primaryKey(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull().default('manual-import'),
    dry_run: boolean('dry_run').notNull().default(false),
    inserted: integer('inserted').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    errors: jsonb('errors').$type<string[]>(),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [index('idx_dataset_imports_created').on(t.created_at)],
);

/* --------------------------- record snapshots ---------------------------- */

export const recordSnapshots = pgTable(
  'record_snapshots',
  {
    id: serial('id').primaryKey(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reason: text('reason').notNull(),
    source: text('source'),
    row_count: integer('row_count').notNull(),
    rows: jsonb('rows').$type<Record<string, unknown>[]>().notNull(),
  },
  (t) => [
    index('idx_record_snapshots_created').on(t.created_at),
    check('record_snapshots_row_count_non_negative', sql`${t.row_count} >= 0`),
  ],
);

/* ---------------------------------- view ---------------------------------- */

/**
 * Records joined with the current course name. API/CSV responses keep exposing
 * `course_name` (ADR-007) without denormalising it in `records`.
 */
export const recordsWithCourseName = pgView('records_with_course_name', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  student_id: text('student_id').notNull(),
  course_id: text('course_id').notNull(),
  course_name: text('course_name').notNull(),
  learning_date: date('learning_date', { mode: 'string' }).notNull(),
  learning_minutes: integer('learning_minutes').notNull(),
  chapters_done: integer('chapters_done').notNull(),
  total_chapters: integer('total_chapters').notNull(),
  quiz_score: doublePrecision('quiz_score'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
}).existing();

