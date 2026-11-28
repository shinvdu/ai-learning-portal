import { z } from 'zod';
import { SimpleOkResponseSchema } from './common.js';

export const UserRoleSchema = z.enum(['admin', 'learner']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/** Session user shape returned by `/auth/me` and login responses. */
export const ClientUserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  role: UserRoleSchema,
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  // Login/register responses include `active`; `/auth/me` does not.
  active: z.boolean().optional(),
});

export type ClientUser = z.infer<typeof ClientUserSchema>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EmailSchema = z
  .string()
  .trim()
  .min(5)
  .max(160)
  .regex(EMAIL_PATTERN, '邮箱格式不正确');

export const PasswordSchema = z.string().min(8, '密码至少需要 8 个字符').max(200, '密码过长');

/* ------------------------------ request bodies ----------------------------- */

export const RegisterBodySchema = z.object({
  name: z.string().trim().min(1, '姓名需要 1–60 个字符').max(60, '姓名需要 1–60 个字符'),
  email: EmailSchema,
  password: PasswordSchema,
});

export type RegisterBody = z.infer<typeof RegisterBodySchema>;

export const LoginBodySchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;

export const MfaBodySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().trim().min(1).max(12),
});

export type MfaBody = z.infer<typeof MfaBodySchema>;

export const VerifyEmailBodySchema = z.object({
  token: z.string().min(1),
});

export type VerifyEmailBody = z.infer<typeof VerifyEmailBodySchema>;

export const ResendVerificationBodySchema = z.object({
  email: EmailSchema,
});

export type ResendVerificationBody = z.infer<typeof ResendVerificationBodySchema>;

export const ForgotPasswordBodySchema = z.object({
  email: EmailSchema,
});

export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;

export const ResetPasswordBodySchema = z.object({
  token: z.string().min(1),
  password: PasswordSchema,
});

export type ResetPasswordBody = z.infer<typeof ResetPasswordBodySchema>;

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: PasswordSchema,
});

export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;

export const MfaEnableBodySchema = z.object({
  code: z.string().trim().min(1).max(12),
});

export type MfaEnableBody = z.infer<typeof MfaEnableBodySchema>;

export const MfaDisableBodySchema = z.object({
  password: z.string().min(1).max(200),
});

export type MfaDisableBody = z.infer<typeof MfaDisableBodySchema>;

/* ------------------------------- responses -------------------------------- */

export const MeResponseSchema = z.object({
  user: ClientUserSchema.nullable(),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

export const AuthUserResponseSchema = z.object({
  user: ClientUserSchema,
});

export type AuthUserResponse = z.infer<typeof AuthUserResponseSchema>;

/** Production registration: verification email sent, no session yet. */
export const RegisterPendingResponseSchema = z.object({
  verificationRequired: z.literal(true),
  email: z.string(),
});

export type RegisterPendingResponse = z.infer<typeof RegisterPendingResponseSchema>;

export const RegisterResponseSchema = z.union([
  AuthUserResponseSchema,
  RegisterPendingResponseSchema,
]);

export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

/** Login with MFA enabled returns a 5-minute challenge instead of a session. */
export const MfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string(),
});

export type MfaChallengeResponse = z.infer<typeof MfaChallengeResponseSchema>;

export const LoginResponseSchema = z.union([AuthUserResponseSchema, MfaChallengeResponseSchema]);

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const MfaResponseSchema = AuthUserResponseSchema;

export type MfaResponse = z.infer<typeof MfaResponseSchema>;

/** Verify-email auto-logs in, or returns an MFA challenge when MFA is enabled. */
export const VerifyEmailResponseSchema = z.object({
  user: ClientUserSchema,
  mfaRequired: z.literal(true).optional(),
  challengeToken: z.string().optional(),
});

export type VerifyEmailResponse = z.infer<typeof VerifyEmailResponseSchema>;

export const MessageOkResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});

export type MessageOkResponse = z.infer<typeof MessageOkResponseSchema>;

export const ResendVerificationResponseSchema = MessageOkResponseSchema;
export type ResendVerificationResponse = z.infer<typeof ResendVerificationResponseSchema>;

export const ForgotPasswordResponseSchema = MessageOkResponseSchema;
export type ForgotPasswordResponse = z.infer<typeof ForgotPasswordResponseSchema>;

export const ResetPasswordResponseSchema = SimpleOkResponseSchema;
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>;

export const ChangePasswordResponseSchema = SimpleOkResponseSchema;
export type ChangePasswordResponse = z.infer<typeof ChangePasswordResponseSchema>;

export const MfaSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
  message: z.string(),
});

export type MfaSetupResponse = z.infer<typeof MfaSetupResponseSchema>;

export const MfaEnableResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

export type MfaEnableResponse = z.infer<typeof MfaEnableResponseSchema>;

export const MfaDisableResponseSchema = SimpleOkResponseSchema;
export type MfaDisableResponse = z.infer<typeof MfaDisableResponseSchema>;

export const LogoutResponseSchema = SimpleOkResponseSchema;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;