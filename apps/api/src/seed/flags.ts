/**
 * Seed flags stored in `app_meta`.
 *
 * The v1 implementation kept a key/value `meta` table and used two flags to
 * make seeding idempotent and to avoid resurrecting data an administrator
 * deliberately deleted:
 *
 * - `catalog_seeded` — set once the initial catalogue has been considered.
 * - `chapters_seeded_<courseId>` — one flag per course.
 *
 * Keeping the same semantics means a restart never re-inserts a course or a
 * chapter that was deleted on purpose (see F021 / architecture M2).
 */
import { eq, like } from 'drizzle-orm';
import { appMeta, type Db } from '@portal/db';

export const CATALOG_SEEDED_KEY = 'catalog_seeded';
export const CHAPTERS_SEEDED_PREFIX = 'chapters_seeded_';

/** Meta key guarding a single course's lecture import. */
export function chaptersSeededKey(courseId: string): string {
  return `${CHAPTERS_SEEDED_PREFIX}${courseId}`;
}

/** A Drizzle transaction shares the same query surface as the database. */
export type SeedTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Anything that can read/write `app_meta`: a pool-backed db or a transaction. */
export type MetaExecutor = Pick<Db, 'select' | 'insert' | 'delete'> | Pick<SeedTx, 'select' | 'insert' | 'delete'>;

/** Read one meta value; returns `null` when the key is absent. */
export async function getMeta(db: MetaExecutor, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, key))
    .limit(1);
  return row?.value ?? null;
}

/** Upsert one meta value as text (matches v1's `setMeta`). */
export async function setMeta(db: MetaExecutor, key: string, value: string | number): Promise<void> {
  const text = String(value);
  await db
    .insert(appMeta)
    .values({ key, value: text })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: text } });
}

/** True when a flag is exactly `1`. */
export async function isFlagSet(db: MetaExecutor, key: string): Promise<boolean> {
  return (await getMeta(db, key)) === '1';
}

/** Set a flag to `1`. */
export async function setFlag(db: MetaExecutor, key: string): Promise<void> {
  await setMeta(db, key, '1');
}

/** Remove every per-course chapter flag (used by `--reset` / `--force`). */
export async function clearChapterFlags(db: MetaExecutor): Promise<void> {
  await db.delete(appMeta).where(like(appMeta.key, `${CHAPTERS_SEEDED_PREFIX}%`));
}

/** Remove the catalogue flag (used by `--force`). */
export async function clearCatalogFlag(db: MetaExecutor): Promise<void> {
  await db.delete(appMeta).where(eq(appMeta.key, CATALOG_SEEDED_KEY));
}