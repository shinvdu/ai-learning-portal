/**
 * Lecture chapter seeding.
 *
 * Mirrors v1 `syncChapters` (`src/db.js`):
 *  - one `chapters_seeded_<courseId>` flag per course;
 *  - only seed a course that still exists;
 *  - skip (and flag) a course that already has chapters so admin edits win;
 *  - warn when the lecture file's chapter count disagrees with the catalogue.
 */
import { count, eq } from 'drizzle-orm';
import { chapters, courses, type Db } from '@portal/db';
import { COURSES, readLecture, type ParsedChapter } from '@portal/content';
import { chaptersSeededKey, isFlagSet, setFlag } from './flags.js';

export type ChapterSeedResult = {
  inserted: number;
  /** Courses whose chapters were already present and therefore skipped. */
  skipped: number;
  /** Courses that vanished before seeding (deleted by an administrator). */
  missing: number;
  warnings: string[];
};

export async function seedChapters(db: Db): Promise<ChapterSeedResult> {
  const result: ChapterSeedResult = { inserted: 0, skipped: 0, missing: 0, warnings: [] };

  for (const course of COURSES) {
    if (!course.lectureFile) continue;
    const flagKey = chaptersSeededKey(course.id);
    if (await isFlagSet(db, flagKey)) continue;

    const [existingCourse] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.id, course.id))
      .limit(1);
    if (!existingCourse) {
      result.missing += 1;
      continue;
    }

    const [chapterCountRow] = await db
      .select({ value: count() })
      .from(chapters)
      .where(eq(chapters.course_id, course.id));
    const existingChapters = Number(chapterCountRow?.value ?? 0);
    if (existingChapters > 0) {
      await setFlag(db, flagKey);
      result.skipped += 1;
      continue;
    }

    let parsed: ParsedChapter[];
    try {
      parsed = readLecture(course.lectureFile);
    } catch (error) {
      result.warnings.push(
        `${course.name}：讲义读取失败（${error instanceof Error ? error.message : String(error)}）`,
      );
      continue;
    }
    if (parsed.length === 0) {
      result.warnings.push(`${course.name}：讲义中未找到章节，跳过`);
      continue;
    }
    if (course.chapters.length !== parsed.length) {
      result.warnings.push(
        `${course.name}：讲义章节数 ${parsed.length} 与课程目录 ${course.chapters.length} 不一致`,
      );
    }

    await db.transaction(async (tx) => {
      await tx.insert(chapters).values(
        parsed.map((chapter) => ({
          course_id: course.id,
          idx: chapter.idx,
          title: chapter.title,
          body: chapter.body,
        })),
      );
      await setFlag(tx, flagKey);
    });
    result.inserted += parsed.length;
  }

  return result;
}