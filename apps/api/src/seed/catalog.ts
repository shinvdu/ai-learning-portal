/**
 * Catalogue + knowledge seeding.
 *
 * Behaviour mirrors v1 `syncCatalog` (`src/db.js`):
 *  1. Insert the five courses only when `catalog_seeded` is not set **and** the
 *     `courses` table is empty.
 *  2. Set `catalog_seeded` whenever it was not set — even when the insert was
 *     skipped — so deleting every course is never undone by a restart.
 *  3. Insert knowledge documents each run, but only for courses that still
 *     exist, with `ON CONFLICT DO NOTHING`.
 *
 * The v2 schema drops the old `chapters_json` column; the catalogue's chapter
 * titles are consumed by `chapters.ts` and only used there for a mismatch
 * warning.
 */
import { count } from 'drizzle-orm';
import { courses, knowledge, type Db } from '@portal/db';
import { COURSES, KNOWLEDGE } from '@portal/content';
import { CATALOG_SEEDED_KEY, isFlagSet, setFlag } from './flags.js';

export type CatalogSeedResult = {
  coursesInserted: number;
  coursesSkipped: number;
  knowledgeInserted: number;
  knowledgeSkipped: number;
  /** True when the catalogue insert ran on this invocation. */
  catalogInserted: boolean;
};

/** Seed the catalogue and knowledge; safe to call on every start-up. */
export async function seedCatalog(db: Db): Promise<CatalogSeedResult> {
  const alreadySeeded = await isFlagSet(db, CATALOG_SEEDED_KEY);
  const [courseCountRow] = await db.select({ value: count() }).from(courses);
  const courseCount = Number(courseCountRow?.value ?? 0);

  let coursesInserted = 0;

  if (!alreadySeeded && courseCount === 0) {
    const inserted = await db
      .insert(courses)
      .values(
        COURSES.map((course, index) => ({
          id: course.id,
          name: course.name,
          category: course.category,
          teacher: course.teacher,
          level: course.level,
          badge: course.badge,
          color: course.color,
          intro: course.intro,
          // Explicit three-state video model (ADR-008): the catalogue relies on
          // the seeded content configuration, so nothing is stored in `video`.
          video_mode: 'inherit' as const,
          video: null,
          // Stable ordering follows the catalogue order (v1 `sort_order = i`).
          sort_order: index,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: courses.id });
    coursesInserted = inserted.length;
  }

  if (!alreadySeeded) {
    await setFlag(db, CATALOG_SEEDED_KEY);
  }

  // Insert knowledge only for courses that actually exist. This keeps a
  // deleted course deleted while still healing gaps (e.g. a course imported
  // without its knowledge document).
  const existing = await db.select({ id: courses.id }).from(courses);
  const existingIds = new Set(existing.map((row) => row.id));
  let knowledgeInserted = 0;
  let knowledgeSkipped = 0;
  for (const course of COURSES) {
    const payload = KNOWLEDGE[course.id];
    if (!payload || !existingIds.has(course.id)) continue;
    const inserted = await db
      .insert(knowledge)
      .values({ course_id: course.id, payload })
      .onConflictDoNothing()
      .returning({ course_id: knowledge.course_id });
    if (inserted.length > 0) knowledgeInserted += 1;
    else knowledgeSkipped += 1;
  }

  return {
    coursesInserted,
    coursesSkipped: COURSES.length - coursesInserted,
    knowledgeInserted,
    knowledgeSkipped,
    catalogInserted: !alreadySeeded && courseCount === 0 && coursesInserted > 0,
  };
}