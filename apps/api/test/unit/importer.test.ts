/**
 * F100 SQLite → PostgreSQL importer tests.
 *
 * Uses a dedicated temporary database (`ai_portal_import_test`) created and
 * migrated by the suite and dropped afterwards. The committed v1 fixture
 * `apps/api/test/fixtures/portal-v1.db` and the configured `ai_portal`
 * database are never written.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { decryptSecret, groupEnrollments, summarize, verifyPassword } from '@portal/domain';
import { runMigrations } from '@portal/db';
import { importSqlite, readSqliteSnapshot } from '../../src/importers/sqlite-to-pg.js';
import { deriveMfaKey } from '../../src/modules/auth/mfa.js';

const FIXTURE_DB = fileURLToPath(new URL('../fixtures/portal-v1.db', import.meta.url));

const IMPORT_DB = 'ai_portal_import_test';
const MAINTENANCE_URL =
  process.env.IMPORT_TEST_MAINTENANCE_URL ?? 'postgres://portal:portal@127.0.0.1:5433/postgres';
const IMPORT_URL =
  process.env.IMPORT_TEST_DATABASE_URL ??
  `postgres://portal:portal@127.0.0.1:5433/${IMPORT_DB}`;
const MFA_KEY = Buffer.alloc(32, 9).toString('base64');
const MFA_PLAINTEXT = 'JBSWY3DPEHPK3PXP';

let client: Client;
const tempDirs: string[] = [];

function copyFixture(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  const copyPath = path.join(dir, 'portal.db');
  copyFileSync(FIXTURE_DB, copyPath);
  return copyPath;
}

async function withMaintenance<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const maintenance = new Client({ connectionString: MAINTENANCE_URL });
  await maintenance.connect();
  try {
    return await fn(maintenance);
  } finally {
    await maintenance.end();
  }
}

async function createDatabase(): Promise<void> {
  await withMaintenance(async (c) => {
    const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [IMPORT_DB]);
    if (rowCount === 0) await c.query(`CREATE DATABASE "${IMPORT_DB}"`);
  });
}

async function dropDatabase(): Promise<void> {
  await withMaintenance(async (c) => {
    await c.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [IMPORT_DB],
    );
    await c.query(`DROP DATABASE IF EXISTS "${IMPORT_DB}"`);
  });
}

async function count(table: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(`select count(*)::text as n from "${table}"`);
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  await createDatabase();
  await runMigrations({ connectionString: IMPORT_URL });
  client = new Client({ connectionString: IMPORT_URL });
  await client.connect();
  process.env.MFA_ENC_KEY = MFA_KEY;
});

afterAll(async () => {
  if (client) await client.end();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  await dropDatabase();
});

describe('sqlite → postgres importer', () => {
  it('reads the v1 fixture read-only and validates every row', () => {
    const snapshot = readSqliteSnapshot(FIXTURE_DB);
    expect(snapshot.users).toHaveLength(1);
    expect(snapshot.courses).toHaveLength(5);
    expect(snapshot.chapters).toHaveLength(30);
    expect(snapshot.knowledge).toHaveLength(5);
    expect(snapshot.records).toHaveLength(177);
    expect(snapshot.audit).toHaveLength(8);
    // Session rows can expire over time; they are the only optional exclusions.
    expect(snapshot.issues.filter((issue) => !issue.startsWith('sessions '))).toEqual([]);
    expect(snapshot.sourceCounts.app_meta).toBe(11);
  });

  it('dry-run reports counts without writing', async () => {
    const report = await importSqlite({
      dbPath: FIXTURE_DB,
      databaseUrl: IMPORT_URL,
      dryRun: true,
    });
    expect(report.mode).toBe('dry-run');
    expect(report.counts.users.source).toBe(1);
    expect(report.counts.courses.source).toBe(5);
    expect(report.counts.chapters.source).toBe(30);
    expect(report.counts.knowledge.source).toBe(5);
    expect(report.counts.records.source).toBe(177);
    expect(report.counts.audit_log.source).toBe(8);
    expect(report.counts.records.targetAfter).toBeNull();
    expect(report.issues.filter((issue) => !issue.startsWith('sessions '))).toEqual([]);
    expect(await count('records')).toBe(0);
    expect(await count('courses')).toBe(0);
    expect(await count('users')).toBe(0);
  });

  it('imports the fixture and matches 5/30/5/177 and the golden metrics', async () => {
    const report = await importSqlite({
      dbPath: FIXTURE_DB,
      databaseUrl: IMPORT_URL,
      wipe: true,
    });
    expect(report.mode).toBe('apply');
    expect(report.counts.courses.targetAfter).toBe(5);
    expect(report.counts.chapters.targetAfter).toBe(30);
    expect(report.counts.knowledge.targetAfter).toBe(5);
    expect(report.counts.records.targetAfter).toBe(177);
    expect(report.counts.audit_log.targetAfter).toBe(8);

    const { rows } = await client.query<{
      student_id: string;
      course_name: string;
      learning_date: string;
      learning_minutes: number;
      chapters_done: number;
      total_chapters: number;
      quiz_score: number | null;
    }>(`select r.student_id, c.name as course_name, r.learning_date::text as learning_date,
          r.learning_minutes, r.chapters_done, r.total_chapters, r.quiz_score
        from records r join courses c on c.id = r.course_id`);
    const overview = summarize(rows, groupEnrollments(rows));
    expect(overview.students).toBe(24);
    expect(overview.courses).toBe(5);
    expect(overview.enrollments).toBe(58);
    expect(overview.avgCompletion).toBe(74.3);
    expect(overview.avgScore).toBe(86.4);
    expect(overview.noScoreEnrollments).toBe(5);
    expect(overview.totalHours).toBe(165.3);
    expect(report.golden).toMatchObject({
      students: 24,
      courses: 5,
      enrollments: 58,
      avgCompletion: 74.3,
      avgScore: 86.4,
      totalHours: 165.3,
    });

    // Audit fields and actor mapping survive.
    const audit = await client.query<{
      id: number;
      action: string;
      actor_email: string | null;
      target_type: string | null;
      target_id: string | null;
      ip: string | null;
    }>('select id, action, actor_email, target_type, target_id, ip from audit_log order by id');
    expect(audit.rows).toHaveLength(8);
    expect(audit.rows[0]).toMatchObject({
      id: 1,
      action: 'auth.login',
      actor_email: 'admin@local.test',
      target_type: 'user',
      target_id: '1.0',
      ip: '127.0.0.1',
    });

    // Users: id and legacy scrypt hash preserved; email lowercase; booleans.
    const users = await client.query<{
      id: number;
      email: string;
      password_hash: string;
      role: string;
      active: boolean;
      email_verified: boolean;
    }>('select id, email, password_hash, role, active, email_verified from users');
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]).toMatchObject({
      id: 1,
      email: 'admin@local.test',
      role: 'admin',
      active: true,
      email_verified: true,
    });
    expect(users.rows[0]?.password_hash.startsWith('scrypt$')).toBe(true);

    // Seed flags and the v1 chapter list are preserved.
    const meta = await client.query<{ key: string; value: string }>(
      "select key, value from app_meta where key in ('catalog_seeded','course_seq') or key like 'chapters_seeded_%' or key like 'legacy_chapters_%'",
    );
    const keys = new Set(meta.rows.map((row) => row.key));
    expect(keys.has('catalog_seeded')).toBe(true);
    expect([...keys].filter((key) => key.startsWith('chapters_seeded_'))).toHaveLength(5);
    expect([...keys].filter((key) => key.startsWith('legacy_chapters_'))).toHaveLength(5);
    expect(meta.rows.find((row) => row.key === 'course_seq')?.value).toBe('5');

    // Sequences advanced past max(id) so the next ids are safe.
    const seq = await client.query<{ course_seq: string; users_seq: string; records_seq: string }>(
      `select (select last_value from course_seq)::text as course_seq,
              (select last_value from users_id_seq)::text as users_seq,
              (select last_value from records_id_seq)::text as records_seq`,
    );
    expect(Number(seq.rows[0]?.course_seq)).toBe(5);
    expect(Number(seq.rows[0]?.users_seq)).toBe(1);
    expect(Number(seq.rows[0]?.records_seq)).toBe(3718);
  });

  it('re-running without --wipe does not duplicate rows', async () => {
    await importSqlite({ dbPath: FIXTURE_DB, databaseUrl: IMPORT_URL });
    expect(await count('users')).toBe(1);
    expect(await count('courses')).toBe(5);
    expect(await count('chapters')).toBe(30);
    expect(await count('knowledge')).toBe(5);
    expect(await count('records')).toBe(177);
    expect(await count('audit_log')).toBe(8);
  });

  it('imports only unexpired sessions when --include-sessions is set', async () => {
    const expected = readSqliteSnapshot(FIXTURE_DB).sessions.length;
    await importSqlite({
      dbPath: FIXTURE_DB,
      databaseUrl: IMPORT_URL,
      wipe: true,
      includeSessions: true,
    });
    expect(await count('sessions')).toBe(expected);
    if (expected > 0) {
      const { rows } = await client.query<{ expires_at: Date }>('select expires_at from sessions');
      expect(rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('maps video modes and encrypts MFA secrets from a copied source', async () => {
    const copyPath = copyFixture('portal-import-mode-');
    const writable = new DatabaseSync(copyPath);
    try {
      writable.prepare("UPDATE courses SET video_json = 'null' WHERE id = 'C1'").run();
      writable
        .prepare(
          `UPDATE courses SET video_json = ? WHERE id = 'C2'`,
        )
        .run(JSON.stringify({ src: '/media/c2.mp4', label: '课程导览视频' }));
      writable
        .prepare("UPDATE users SET mfa_secret = ?, mfa_enabled = 1 WHERE id = 1")
        .run(MFA_PLAINTEXT);
    } finally {
      writable.close();
    }

    const report = await importSqlite({ dbPath: copyPath, databaseUrl: IMPORT_URL, wipe: true });
    expect(report.videoModes).toEqual({ inherit: 3, custom: 1, none: 1 });

    const { rows } = await client.query<{ id: string; video_mode: string; video: unknown }>(
      'select id, video_mode, video from courses order by id',
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('C1')).toMatchObject({ video_mode: 'none', video: null });
    expect(byId.get('C2')).toMatchObject({ video_mode: 'custom' });
    expect(byId.get('C2')?.video).toMatchObject({ src: '/media/c2.mp4' });
    expect(byId.get('C3')).toMatchObject({ video_mode: 'inherit', video: null });

    const user = await client.query<{ mfa_secret: string; mfa_enabled: boolean }>(
      'select mfa_secret, mfa_enabled from users where id = 1',
    );
    expect(user.rows[0]?.mfa_enabled).toBe(true);
    const encrypted = user.rows[0]?.mfa_secret ?? '';
    expect(encrypted).toMatch(/^v1:/);
    expect(decryptSecret(encrypted, deriveMfaKey(MFA_KEY))).toBe(MFA_PLAINTEXT);
  });

  it('preserves legacy scrypt hashes for transparent login upgrade', async () => {
    const { randomBytes, scryptSync } = await import('node:crypto');
    const copyPath = copyFixture('portal-import-scrypt-');
    const salt = randomBytes(16);
    const hash = scryptSync('legacy-password', salt, 64);
    const scryptValue = `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
    const writable = new DatabaseSync(copyPath);
    try {
      writable.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(scryptValue);
    } finally {
      writable.close();
    }

    await importSqlite({ dbPath: copyPath, databaseUrl: IMPORT_URL, wipe: true });
    const { rows } = await client.query<{ password_hash: string }>(
      'select password_hash from users where id = 1',
    );
    const stored = rows[0]?.password_hash ?? '';
    expect(stored).toBe(scryptValue);
    await expect(verifyPassword('legacy-password', stored)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });
});