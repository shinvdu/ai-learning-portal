import { z } from 'zod';
import { EmailSchema, PasswordSchema, UserRoleSchema } from './auth.js';

/** Safe admin-facing user row (v1 `listUsers`; no password hash). */
export const AdminUserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  role: UserRoleSchema,
  active: z.boolean(),
  email_verified: z.boolean(),
  mfa_enabled: z.boolean(),
  failed_attempts: z.number().int(),
  /** Epoch milliseconds, matching the v1 SQLite column. */
  locked_until: z.number().nullable(),
  created_at: z.string(),
  last_login_at: z.string().nullable(),
});

export type AdminUser = z.infer<typeof AdminUserSchema>;

export const UsersResponseSchema = z.object({
  users: z.array(AdminUserSchema),
});

export type UsersResponse = z.infer<typeof UsersResponseSchema>;

export const UserPathParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type UserPathParams = z.infer<typeof UserPathParamsSchema>;

export const CreateUserBodySchema = z.object({
  name: z.string().trim().min(1, '姓名需要 1–60 个字符').max(60, '姓名需要 1–60 个字符'),
  email: EmailSchema,
  password: PasswordSchema,
  role: UserRoleSchema.optional(),
  active: z.boolean().optional(),
});

export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;

export const UpdateUserBodySchema = z.object({
  name: z.string().trim().min(1, '姓名需要 1–60 个字符').max(60, '姓名需要 1–60 个字符').optional(),
  role: UserRoleSchema.optional(),
  active: z.boolean().optional(),
  password: PasswordSchema.optional(),
  unlock: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  resetMfa: z.boolean().optional(),
});

export type UpdateUserBody = z.infer<typeof UpdateUserBodySchema>;

export const UserMutationResponseSchema = z.object({
  ok: z.literal(true),
  user: AdminUserSchema,
});

export type UserMutationResponse = z.infer<typeof UserMutationResponseSchema>;

/** v1 returns `{ok:false, notFound?, errors}` for user validation failures. */
export const UserErrorResponseSchema = z.object({
  ok: z.literal(false),
  notFound: z.boolean().optional(),
  errors: z.array(z.string()),
});

export type UserErrorResponse = z.infer<typeof UserErrorResponseSchema>;