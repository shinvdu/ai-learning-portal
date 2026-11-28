import { z } from 'zod';

/** Dataset metadata embedded in `/meta`, `/dashboard`, `/insights` and mutations. */
export const DatasetMetaSchema = z.object({
  source: z.string(),
  seedFile: z.string(),
  updatedAt: z.string().nullable(),
  importedAt: z.string().nullable(),
  manualEdits: z.number().int().nonnegative(),
});

export type DatasetMeta = z.infer<typeof DatasetMetaSchema>;

/** `POST /records/import` JSON body. The route also accepts raw `text/csv`. */
export const ImportBodySchema = z.object({
  csv: z.string().min(1),
});

export type ImportBody = z.infer<typeof ImportBodySchema>;

/** Result of a whole-table CSV replacement (import, reset or dry-run). */
export const ImportResultSchema = z.object({
  ok: z.boolean(),
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

export type ImportResult = z.infer<typeof ImportResultSchema>;

/** Import/reset responses append the refreshed dataset metadata. */
export const ImportResponseSchema = ImportResultSchema.extend({
  dataset: DatasetMetaSchema,
});

export type ImportResponse = z.infer<typeof ImportResponseSchema>;

export const ResetResponseSchema = ImportResponseSchema;
export type ResetResponse = z.infer<typeof ResetResponseSchema>;