import { z } from 'zod';
import { optionalQueryString, paginatedSchema } from './common.js';
import { DatasetMetaSchema } from './dataset.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isCalendarDate = (value: string): boolean => {
  if (!DATE_RE.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const LearningDateSchema = z
  .string()
  .trim()
  .refine(isCalendarDate, 'learning_date 需为有效的 YYYY-MM-DD 日期');

/** A persisted learning record as returned by `GET /records` (v1 columns). */
export const RecordRowSchema = z.object({
  id: z.number().int(),
  student_id: z.string(),
  course_name: z.string(),
  learning_date: z.string(),
  learning_minutes: z.number(),
  chapters_done: z.number().int(),
  total_chapters: z.number().int(),
  quiz_score: z.number().nullable(),
  created_at: z.string(),
  /** v2 joins the FK; kept optional for v1-compatible repositories. */
  course_id: z.string().optional(),
});

export type RecordRow = z.infer<typeof RecordRowSchema>;

const RecordFieldsSchema = z.object({
  student_id: z.string().trim().min(1, 'student_id 不能为空').max(32, 'student_id 过长'),
  course_name: z.string().trim().min(1, 'course_name 不能为空'),
  learning_date: LearningDateSchema,
  learning_minutes: z.coerce
    .number()
    .int('learning_minutes 需为 0–1440 的整数')
    .min(0, 'learning_minutes 需为 0–1440 的整数')
    .max(1440, 'learning_minutes 需为 0–1440 的整数'),
  chapters_done: z.coerce
    .number()
    .int('chapters_done 需为非负整数')
    .min(0, 'chapters_done 需为非负整数'),
  total_chapters: z.coerce
    .number()
    .int('total_chapters 需为正整数')
    .min(1, 'total_chapters 需为正整数'),
  quiz_score: z
    .number()
    .min(0, 'quiz_score 需为 0–100 或留空')
    .max(100, 'quiz_score 需为 0–100 或留空')
    .nullable()
    .default(null),
});

export const RecordInputSchema = RecordFieldsSchema.refine(
  (value) => value.chapters_done <= value.total_chapters,
  { message: 'chapters_done 不能大于 total_chapters', path: ['chapters_done'] },
);

export type RecordInput = z.infer<typeof RecordInputSchema>;

/** PATCH accepts any subset of the editable columns; service revalidates merged row. */
export const RecordPatchSchema = RecordFieldsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: '没有需要更新的字段' },
);

export type RecordPatch = z.infer<typeof RecordPatchSchema>;

function boundedIntQuery(min: number, max: number, defaultValue: number) {
  return z.preprocess(
    (value) =>
      value === undefined || value === null || value === ''
        ? defaultValue
        : typeof value === 'string'
          ? Number(value)
          : value,
    z.number().int().min(min).max(max),
  );
}

export const RecordsQuerySchema = z.object({
  course: optionalQueryString,
  student: optionalQueryString,
  q: optionalQueryString,
  limit: boundedIntQuery(1, 200, 20),
  offset: boundedIntQuery(0, Number.MAX_SAFE_INTEGER, 0),
});

export type RecordsQuery = z.infer<typeof RecordsQuerySchema>;

export const RecordPathParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type RecordPathParams = z.infer<typeof RecordPathParamsSchema>;

export const RecordsResponseSchema = paginatedSchema(RecordRowSchema);
export type RecordsResponse = z.infer<typeof RecordsResponseSchema>;

export const RecordMutationResponseSchema = z.object({
  ok: z.literal(true),
  record: RecordRowSchema,
  dataset: DatasetMetaSchema,
});

export type RecordMutationResponse = z.infer<typeof RecordMutationResponseSchema>;

export const RecordDeleteResponseSchema = z.object({
  ok: z.literal(true),
  dataset: DatasetMetaSchema,
});

export type RecordDeleteResponse = z.infer<typeof RecordDeleteResponseSchema>;

/** Domain-level validation failure (v1 returns `{ok:false, errors}`). */
export const RecordErrorResponseSchema = z.object({
  ok: z.literal(false),
  notFound: z.boolean().optional(),
  conflict: z.boolean().optional(),
  errors: z.array(z.string()),
});

export type RecordErrorResponse = z.infer<typeof RecordErrorResponseSchema>;