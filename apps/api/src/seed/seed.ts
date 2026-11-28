/**
 * Seed CLI: catalogue → chapters → demo records → `course_seq` alignment.
 *
 * Usage:
 *   npm run seed -w @portal/api -- --demo-records
 *   npm run seed -w @portal/api -- --reset --demo-records
 *   npm run seed -w @portal/api -- --force
 *
 * Flags:
 *   --demo-records  Import the packaged demo CSV (explicit opt-in, even in
 *                   production). Same effect as `SEED_DEMO_RECORDS=1`.
 *   --reset         Destructively delete seeded domain data (records, courses,
 *                   chapters, knowledge) and the seed flags, then reseed.
 *                   In production this additionally requires
 *                   `ALLOW_DEMO_RESET=1`.
 *   --force         Clear the idempotency flags so the catalogue/chapter stages
 *                   re-run. Emptiness checks still prevent duplicate inserts.
 *
 * Demo records are skipped by default in production, and imported by default
 * outside production unless `SEED_DEMO_RECORDS=0` is set (v1 semantics).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { count, eq, sql } from 'drizzle-orm';
import {
  appMeta,
  chapters,
  courses,
  createDb,
  createPool,
  knowledge,
  records as recordsTable,
  type Db,
} from '@portal/db';
import { seedCatalog, type CatalogSeedResult } from './catalog.js';
import { seedChapters, type ChapterSeedResult } from './chapters.js';
import { seedRecords, type SeedRecordsResult } from './records.js';
import {
  CATALOG_SEEDED_KEY,
  clearCatalogFlag,
  clearChapterFlags,
  getMeta,
  setMeta,
  type MetaExecutor,
} from './flags.js';

export type SeedCliOptions = {
  demoRecords: boolean;
  reset: boolean;
  force: boolean;
  production: boolean;
};

export type SeedReport = {
  catalog: CatalogSeedResult;
  chapters: ChapterSeedResult;
  records: SeedRecordsResult;
  counts: {
    courses: number;
    chapters: number;
    knowledge: number;
    records: number;
  };
  courseSequence: number;
  demoAllowed: boolean;
  production: boolean;
};

/** Production when either conventional env flag is set (v1 semantics). */
export function isProductionEnv(): boolean {
  return process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
}

/**
 * Demo records are imported when explicitly requested (`--demo-records` or
 * `SEED_DEMO_RECORDS=1`) or, outside production, unless explicitly disabled.
 */
export function isDemoAllowed(production: boolean, demoRecordsFlag: boolean): boolean {
  if (demoRecordsFlag || process.env.SEED_DEMO_RECORDS === '1') return true;
  return !production && process.env.SEED_DEMO_RECORDS !== '0';
}

async function tableCount(db: Db, table: typeof courses | typeof chapters | typeof knowledge | typeof recordsTable) {
  const [row] = await db.select({ value: count() }).from(table);
  return Number(row?.value ?? 0);
}

/** Delete seeded domain data and the seed flags inside one transaction. */
export async function resetSeedData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    // `records.course_id` is ON DELETE RESTRICT, so records go first.
    await tx.delete(recordsTable);
    await tx.delete(chapters);
    await tx.delete(knowledge);
    await tx.delete(courses);
    await tx.delete(appMeta).where(eq(appMeta.key, CATALOG_SEEDED_KEY));
    await clearChapterFlags(tx);
  });
}

/**
 * Align `course_seq` with the highest existing course number, the legacy
 * `course_seq` meta value (migrated v1 databases) and the sequence's own
 * current position. `setval(..., true)` makes the next `nextval` return
 * `target + 1`, i.e. `C6` after seeding `C1–C5`.
 *
 * Including the sequence position keeps ids monotonic when the newest course
 * was deleted after being created; persisting the target back into
 * `app_meta.course_seq` carries the high-water mark across delete-all.
 */
export async function syncCourseSequence(db: Db): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`coalesce(max(${courses.id_num}), 0)` })
    .from(courses);
  const maxId = Number(row?.value ?? 0);
  const legacyRaw = await getMeta(db as MetaExecutor, 'course_seq');
  const legacy = Number.parseInt(legacyRaw ?? '', 10);
  const sequenceResult = await db.execute<{ last_value: string }>(
    sql`select last_value::text as last_value from course_seq`,
  );
  const sequenceLast = Number.parseInt(sequenceResult.rows[0]?.last_value ?? '', 10);
  const target = Math.max(
    maxId,
    Number.isFinite(legacy) ? legacy : 0,
    Number.isFinite(sequenceLast) ? sequenceLast : 0,
    1,
  );
  await db.execute(sql`select setval('course_seq', ${target}, true)`);
  await setMeta(db as MetaExecutor, 'course_seq', target);
  return target;
}

/** Run the full idempotent seed pipeline against an open database. */
export async function runSeed(db: Db, options: SeedCliOptions): Promise<SeedReport> {
  const demoAllowed = isDemoAllowed(options.production, options.demoRecords);

  if (options.production && options.reset && process.env.ALLOW_DEMO_RESET !== '1') {
    throw new Error('生产环境执行 --reset 需要显式设置 ALLOW_DEMO_RESET=1');
  }
  if (options.reset) await resetSeedData(db);
  if (options.force) {
    await clearCatalogFlag(db);
    await clearChapterFlags(db);
  }

  const catalog = await seedCatalog(db);
  const chapterResult = await seedChapters(db);
  const recordResult = await seedRecords(db, { allowDemo: demoAllowed });
  const courseSequence = await syncCourseSequence(db);

  return {
    catalog,
    chapters: chapterResult,
    records: recordResult,
    counts: {
      courses: await tableCount(db, courses),
      chapters: await tableCount(db, chapters),
      knowledge: await tableCount(db, knowledge),
      records: await tableCount(db, recordsTable),
    },
    courseSequence,
    demoAllowed,
    production: options.production,
  };
}

/** Parse CLI flags; unknown flags are ignored so extra npm args do not break. */
export function parseCliOptions(argv: readonly string[], production = isProductionEnv()): SeedCliOptions {
  const flags = new Set(argv);
  return {
    demoRecords: flags.has('--demo-records'),
    reset: flags.has('--reset'),
    force: flags.has('--force'),
    production,
  };
}

export function printReport(report: SeedReport): void {
  console.log(
    `[seed] 课程：新增 ${report.catalog.coursesInserted}，跳过 ${report.catalog.coursesSkipped}`,
  );
  console.log(
    `[seed] 知识：新增 ${report.catalog.knowledgeInserted}，跳过 ${report.catalog.knowledgeSkipped}`,
  );
  console.log(
    `[seed] 章节：新增 ${report.chapters.inserted}，跳过 ${report.chapters.skipped}，缺失课程 ${report.chapters.missing}`,
  );
  if (report.records.skippedReason === 'demo-disabled') {
    console.log('[seed] 学习记录：已跳过（未允许演示数据）');
  } else if (report.records.skippedReason === 'records-not-empty') {
    console.log('[seed] 学习记录：已跳过（records 非空）');
  } else if (report.records.skippedReason === 'no-courses') {
    console.log('[seed] 学习记录：已跳过（课程目录为空，管理员已删除课程）');
  } else {
    console.log(
      `[seed] 学习记录：新增 ${report.records.inserted}，跳过 ${report.records.skipped}`,
    );
    if (report.records.file) console.log(`[seed] 种子文件：${report.records.file}`);
  }
  for (const warning of report.chapters.warnings) console.warn(`[seed] 警告：${warning}`);
  for (const error of report.records.errors) console.warn(`[seed] 无效行：${error}`);
  console.log(
    `[seed] 数据库现状：${report.counts.courses} 课 / ${report.counts.chapters} 章 / ${report.counts.knowledge} 知识 / ${report.counts.records} 记录`,
  );
  console.log(`[seed] course_seq 已对齐到 ${report.courseSequence}（下一个 C${report.courseSequence + 1}）`);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const pool = createPool();
  const db = createDb(pool);
  try {
    const report = await runSeed(db, options);
    printReport(report);
  } finally {
    await pool.end();
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error: unknown) => {
    console.error('[seed] 失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}