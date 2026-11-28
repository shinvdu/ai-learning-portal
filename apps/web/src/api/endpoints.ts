/**
 * Typed endpoint map for every route the UI consumes.
 *
 * Paths are relative to `/api/v1` (see `client.ts`). Read the API route files
 * under `apps/api/src/modules/*\/routes.ts` before changing a shape here.
 */
import { apiRequest, apiRequestBlob, withQuery } from './client';
import type {
  AdminCoursesResponse,
  AdminUser,
  AuditQuery,
  AuditResponse,
  ChapterCreateBody,
  ChapterDeleteResponse,
  ChapterMutationResponse,
  ChapterResponse,
  ChapterUpdateBody,
  CourseCreateBody,
  CourseDeleteResponse,
  CourseDetailResponse,
  CourseMutationResponse,
  CourseUpdateBody,
  CoursesResponse,
  CreateUserBody,
  CsrfResponse,
  DashboardResponse,
  ImportResponse,
  InsightsResponse,
  KnowledgeResponse,
  LoginInput,
  LoginResponse,
  MfaBody,
  MfaEnableResponse,
  MfaResponse,
  MfaSetupResponse,
  MeResponse,
  MessageOkResponse,
  MetaResponse,
  RecordDeleteResponse,
  RecordInput,
  RecordMutationResponse,
  RecordPatch,
  RecordsQuery,
  RecordsResponse,
  RegisterInput,
  RegisterResponse,
  ResetResponse,
  SimpleOkResponse,
  UpdateUserBody,
  UserMutationResponse,
  UsersResponse,
  VerifyEmailResponse,
} from './types';

const enc = encodeURIComponent;

/* ----------------------------------- auth ---------------------------------- */

export const authApi = {
  me(): Promise<MeResponse> {
    return apiRequest('/auth/me');
  },

  csrf(): Promise<CsrfResponse> {
    return apiRequest('/auth/csrf', { headers: { 'Cache-Control': 'no-store' } });
  },

  register(body: RegisterInput): Promise<RegisterResponse> {
    return apiRequest('/auth/register', { method: 'POST', body });
  },

  /** Invalid credentials return 401; do not broadcast a global sign-out. */
  login(body: LoginInput): Promise<LoginResponse> {
    return apiRequest('/auth/login', { method: 'POST', body, suppressAuthEvent: true });
  },

  mfa(body: MfaBody): Promise<MfaResponse> {
    return apiRequest('/auth/mfa', { method: 'POST', body, suppressAuthEvent: true });
  },

  verifyEmail(token: string): Promise<VerifyEmailResponse> {
    return apiRequest('/auth/verify-email', { method: 'POST', body: { token } });
  },

  resendVerification(email: string): Promise<MessageOkResponse> {
    return apiRequest('/auth/resend-verification', { method: 'POST', body: { email } });
  },

  forgotPassword(email: string): Promise<MessageOkResponse> {
    return apiRequest('/auth/forgot-password', { method: 'POST', body: { email } });
  },

  resetPassword(token: string, password: string): Promise<SimpleOkResponse> {
    return apiRequest('/auth/reset-password', { method: 'POST', body: { token, password } });
  },

  changePassword(currentPassword: string, newPassword: string): Promise<SimpleOkResponse> {
    return apiRequest('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  },

  logout(): Promise<SimpleOkResponse> {
    return apiRequest('/auth/logout', { method: 'POST', suppressAuthEvent: true });
  },

  mfaSetup(): Promise<MfaSetupResponse> {
    return apiRequest('/auth/mfa/setup', { method: 'POST' });
  },

  mfaEnable(code: string): Promise<MfaEnableResponse> {
    return apiRequest('/auth/mfa/enable', { method: 'POST', body: { code } });
  },

  mfaDisable(password: string): Promise<SimpleOkResponse> {
    return apiRequest('/auth/mfa/disable', { method: 'POST', body: { password } });
  },
};

/* --------------------------------- catalogue -------------------------------- */

export type CoursesQuery = { q?: string; category?: string };

export const catalogApi = {
  meta(): Promise<MetaResponse> {
    return apiRequest('/meta');
  },

  courses(query: CoursesQuery = {}): Promise<CoursesResponse> {
    return apiRequest(withQuery('/courses', query));
  },

  course(idOrName: string): Promise<CourseDetailResponse> {
    return apiRequest(`/courses/${enc(idOrName)}`);
  },

  chapter(courseId: string, idx: number | string): Promise<ChapterResponse> {
    return apiRequest(`/chapters/${enc(courseId)}/${enc(String(idx))}`);
  },

  knowledge(id: string): Promise<KnowledgeResponse> {
    return apiRequest(`/knowledge/${enc(id)}`);
  },
};

/* --------------------------------- analytics -------------------------------- */

export const analyticsApi = {
  dashboard(course?: string): Promise<DashboardResponse> {
    return apiRequest(withQuery('/dashboard', { course }));
  },

  insights(): Promise<InsightsResponse> {
    return apiRequest('/insights');
  },
};

/* ---------------------------------- records --------------------------------- */

export const recordsApi = {
  list(query: RecordsQuery = {}): Promise<RecordsResponse> {
    return apiRequest(withQuery('/records', query));
  },

  create(input: RecordInput): Promise<RecordMutationResponse> {
    return apiRequest('/records', { method: 'POST', body: input });
  },

  update(id: number, patch: RecordPatch): Promise<RecordMutationResponse> {
    return apiRequest(`/records/${id}`, { method: 'PATCH', body: patch });
  },

  remove(id: number): Promise<RecordDeleteResponse> {
    return apiRequest(`/records/${id}`, { method: 'DELETE' });
  },

  /** Whole-table replacement; `dryRun` parses/validates without writing. */
  importCsv(csv: string, dryRun = false): Promise<ImportResponse> {
    return apiRequest(withQuery('/records/import', { dry_run: dryRun ? 1 : undefined }), {
      method: 'POST',
      body: csv,
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    });
  },

  /** Same endpoint with the JSON `{csv}` envelope (useful for tests/debugging). */
  importCsvJson(csv: string, dryRun = false): Promise<ImportResponse> {
    return apiRequest(withQuery('/records/import', { dry_run: dryRun ? 1 : undefined }), {
      method: 'POST',
      body: { csv },
    });
  },

  async exportCsv(): Promise<{ blob: Blob; filename: string | null }> {
    return apiRequestBlob('/export.csv');
  },
};

/* ---------------------------------- admin ----------------------------------- */

export const adminApi = {
  users: {
    list(): Promise<UsersResponse> {
      return apiRequest('/admin/users');
    },

    create(body: CreateUserBody): Promise<UserMutationResponse> {
      return apiRequest('/admin/users', { method: 'POST', body });
    },

    update(id: number, patch: UpdateUserBody): Promise<UserMutationResponse> {
      return apiRequest(`/admin/users/${id}`, { method: 'PATCH', body: patch });
    },
  },

  courses: {
    list(): Promise<AdminCoursesResponse> {
      return apiRequest('/admin/courses');
    },

    create(body: CourseCreateBody): Promise<CourseMutationResponse> {
      return apiRequest('/admin/courses', { method: 'POST', body });
    },

    update(id: string, patch: CourseUpdateBody): Promise<CourseMutationResponse> {
      return apiRequest(`/admin/courses/${enc(id)}`, { method: 'PATCH', body: patch });
    },

    remove(id: string, force = false): Promise<CourseDeleteResponse> {
      return apiRequest(withQuery(`/admin/courses/${enc(id)}`, { force: force ? 1 : undefined }), {
        method: 'DELETE',
      });
    },
  },

  chapters: {
    create(courseId: string, body: ChapterCreateBody): Promise<ChapterMutationResponse> {
      return apiRequest(`/admin/courses/${enc(courseId)}/chapters`, {
        method: 'POST',
        body,
      });
    },

    update(
      courseId: string,
      idx: number,
      patch: ChapterUpdateBody,
    ): Promise<ChapterMutationResponse> {
      return apiRequest(`/admin/courses/${enc(courseId)}/chapters/${idx}`, {
        method: 'PATCH',
        body: patch,
      });
    },

    remove(courseId: string, idx: number): Promise<ChapterDeleteResponse> {
      return apiRequest(`/admin/courses/${enc(courseId)}/chapters/${idx}`, {
        method: 'DELETE',
      });
    },
  },

  audit: {
    list(query: AuditQuery = {}): Promise<AuditResponse> {
      return apiRequest(withQuery('/admin/audit', query));
    },
  },
};

/* ---------------------------------- dataset --------------------------------- */

export const datasetApi = {
  /** Restores the bundled demo dataset (production may return 403). */
  reset(): Promise<ResetResponse> {
    return apiRequest('/admin/reset', { method: 'POST' });
  },
};

export type { AdminUser };