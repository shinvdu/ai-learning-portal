import { z } from 'zod';

export const QuizSchema = z.object({
  q: z.string(),
  options: z.array(z.string()),
  /** Zero-based index into `options`. */
  answer: z.number().int().nonnegative(),
  explanation: z.string(),
  source: z.string(),
});

export type Quiz = z.infer<typeof QuizSchema>;

export const KnowledgeTermSchema = z.object({
  term: z.string(),
  definition: z.string(),
});

export type KnowledgeTerm = z.infer<typeof KnowledgeTermSchema>;

export const KnowledgeFaqSchema = z.object({
  q: z.string(),
  a: z.string(),
});

export type KnowledgeFaq = z.infer<typeof KnowledgeFaqSchema>;

export const KnowledgeReviewSchema = z.object({
  before: z.string(),
  after: z.string(),
  note: z.string(),
});

export type KnowledgeReview = z.infer<typeof KnowledgeReviewSchema>;

export const KnowledgeOriginalSchema = z.object({
  chapter: z.string(),
  text: z.string(),
});

export type KnowledgeOriginal = z.infer<typeof KnowledgeOriginalSchema>;

/** Knowledge-center payload stored in `knowledge.payload` and returned verbatim. */
export const KnowledgePayloadSchema = z.object({
  title: z.string(),
  source: z.string(),
  summary: z.string(),
  objectives: z.array(z.string()),
  points: z.array(z.string()),
  terms: z.array(KnowledgeTermSchema),
  faq: z.array(KnowledgeFaqSchema),
  quiz: z.array(QuizSchema),
  review: KnowledgeReviewSchema,
  original: z.array(KnowledgeOriginalSchema),
});

export type KnowledgePayload = z.infer<typeof KnowledgePayloadSchema>;

export const KnowledgePathParamsSchema = z.object({
  id: z.string().min(1),
});

export type KnowledgePathParams = z.infer<typeof KnowledgePathParamsSchema>;

export const KnowledgeCourseSchema = z.object({
  id: z.string(),
  name: z.string(),
  chapters: z.array(z.string()),
  color: z.string().nullable(),
  badge: z.string().nullable(),
});

export type KnowledgeCourse = z.infer<typeof KnowledgeCourseSchema>;

export const KnowledgeResponseSchema = z.object({
  course: KnowledgeCourseSchema,
  knowledge: KnowledgePayloadSchema.nullable(),
});

export type KnowledgeResponse = z.infer<typeof KnowledgeResponseSchema>;