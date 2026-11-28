/**
 * API response/request types.
 *
 * Mirrored from `packages/contracts/src/*` (zod schemas). The API is the source
 * of truth; when a shape changes there, update this file too. These types are
 * compile-time only — nothing is validated at runtime on the client.
 */

/* ------------------------------- error envelope ------------------------------ */

export type ApiErrorPayload = {
  error?: string;
  errors?: string[];
  code?: string;
  ok?: false;
  notFound?: boolean;
  conflict?: boolean;
};

/* ----------------------------------- auth ----------------------------------- */

export type UserRole = 'admin' | 'learner';

export type ClientUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: boolean;
  mfaEnabled: boolean;
  /** Present on login/register responses, absent on `/auth/me`. */
  active?: boolean;
};

export type MeResponse = { user: ClientUser | null };
export type AuthUserResponse = { user: ClientUser };

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

export type RegisterPendingResponse = {
  verificationRequired: true;
  email: string;
};

export type RegisterResponse = AuthUserResponse | RegisterPendingResponse;

export type LoginInput = { email: string; password: string };

export type MfaChallengeResponse = {
  mfaRequired: true;
  challengeToken: string;
};

export type LoginResponse = AuthUserResponse | MfaChallengeResponse;

export type MfaBody = { challengeToken: string; code: string };
export type MfaResponse = AuthUserResponse;

export type VerifyEmailResponse = {
  user: ClientUser;
  mfaRequired?: true;
  challengeToken?: string;
};

export type MessageOkResponse = { ok: true; message: string };
export type SimpleOkResponse = { ok: true };

export type MfaSetupResponse = {
  secret: string;
  otpauthUri: string;
  message: string;
};

export type MfaEnableResponse = { recoveryCodes: string[] };

export type CsrfResponse = { csrfToken: string };

/* ------------------------------- dataset meta ------------------------------- */

export type DatasetMeta = {
  source: string;
  seedFile: string;
  updatedAt: string | null;
  importedAt: string | null;
  manualEdits: number;
};

/* ------------------------------- course catalog ----------------------------- */

export type VideoMode = 'inherit' | 'custom' | 'none';

export type CourseVideo = {
  src: string;
  poster?: string;
  duration?: string;
  durationText?: string;
  label?: string;
  note?: string;
  isPlaceholder?: boolean;
};

export type CourseMeta = {
  id: string;
  name: string;
  category: string;
  teacher: string;
  level: string;
  badge: string | null;
  color: string | null;
  intro: string | null;
  sort_order: number;
  chapters: string[];
  video: CourseVideo | null;
  video_mode?: VideoMode;
};

export type ChapterRow = {
  idx: number;
  title: string;
  body: string;
};

export type ChapterStat = {
  idx: number;
  title: string;
  total: number;
  reached: number;
  notReached: number;
  reachRate: number | null;
  avgScoreReached: number | null;
  avgScoreNotReached: number | null;
  scoredReached: number;
  scoredNotReached: number;
};

/* -------------------------------- analytics --------------------------------- */

export type Overview = {
  students: number;
  courses: number;
  enrollments: number;
  records: number;
  avgCompletion: number | null;
  avgScore: number | null;
  scoredEnrollments: number;
  noScoreEnrollments: number;
  totalMinutes: number;
  totalHours: number | null;
};

export type CourseStats = {
  course_name: string;
  learners: number;
  records: number;
  enrollments: number;
  completion: number | null;
  avgScore: number | null;
  scoredEnrollments: number;
  noScoreEnrollments: number;
  minutes: number;
  hours: number | null;
  chapters: number;
};

export type CourseWithStats = CourseMeta & { stats: CourseStats };

export type CoursesResponse = {
  courses: CourseWithStats[];
  categories: string[];
  overview: Overview;
};

export type CourseDetailResponse = {
  course: CourseMeta;
  stats: CourseStats;
  chapterStats: ChapterStat[];
};

export type MetaResponse = {
  overview: Overview;
  dataset: DatasetMeta;
  courses: Array<{ id: string; name: string; category: string }>;
};

export type DailyPoint = {
  date: string;
  sessions: number;
  minutes: number;
  students: number;
};

export type WeekdayStat = {
  label: string;
  sessions: number;
  minutes: number;
  students: number;
};

export type Bucket = { label: string; count: number };

export type DataQuality = {
  dateFrom: string | null;
  dateTo: string | null;
  days: number;
  records: number;
  enrollments: number;
  students: number;
  courses: number;
  noScoreEnrollments: number;
  scoredEnrollments: number;
};

export type InsightType = 'progress' | 'correlation' | 'timing' | 'quality' | 'comparison';

export type Insight = {
  id: string;
  type: InsightType;
  tag: string;
  title: string;
  evidence: string;
  action: string;
};

export type CourseCatalogItem = {
  id: string;
  name: string;
  color: string | null;
  badge: string | null;
};

export type DashboardResponse = {
  overview: Overview;
  byCourse: CourseStats[];
  daily: DailyPoint[];
  weekday: WeekdayStat[];
  completionBuckets: Bucket[];
  scoreBuckets: Bucket[];
  quality: DataQuality;
  insights: Insight[];
  filter: string | null;
  courseOptions: string[];
  courseCatalog: CourseCatalogItem[];
  dataset: DatasetMeta;
};

export type Pitfall = {
  metric: string;
  wrong: string;
  reason: string;
  correctHint: string;
};

export type InsightsResponse = {
  overview: Overview;
  byCourse: CourseStats[];
  insights: Insight[];
  pitfalls: Pitfall[];
  dataset: DatasetMeta;
  quality: DataQuality;
  courseCatalog: CourseCatalogItem[];
};

/* -------------------------------- chapters ---------------------------------- */

export type ChapterCourse = {
  id: string;
  name: string;
  color: string | null;
  badge: string | null;
  chapters: string[];
  video: CourseVideo | null;
};

/** Resolved chapter video; `null` when the chapter (or its course) has none. */
export type ChapterDetail = ChapterRow & { video: CourseVideo | null };

export type Quiz = {
  q: string;
  options: string[];
  /** Zero-based index into `options`. */
  answer: number;
  explanation: string;
  source: string;
};

export type ChapterResponse = {
  course: ChapterCourse;
  chapter: ChapterDetail;
  stats: ChapterStat | null;
  chapterStats: ChapterStat[];
  relatedQuiz: Quiz[];
  prev: ChapterRow | null;
  next: ChapterRow | null;
};

/* -------------------------------- knowledge --------------------------------- */

export type KnowledgeTerm = { term: string; definition: string };
export type KnowledgeFaq = { q: string; a: string };
export type KnowledgeReview = { before: string; after: string; note: string };
export type KnowledgeOriginal = { chapter: string; text: string };

export type KnowledgePayload = {
  title: string;
  source: string;
  summary: string;
  objectives: string[];
  points: string[];
  terms: KnowledgeTerm[];
  faq: KnowledgeFaq[];
  quiz: Quiz[];
  review: KnowledgeReview;
  original: KnowledgeOriginal[];
};

export type KnowledgeCourse = {
  id: string;
  name: string;
  chapters: string[];
  color: string | null;
  badge: string | null;
};

export type KnowledgeResponse = {
  course: KnowledgeCourse;
  knowledge: KnowledgePayload | null;
};

/* --------------------------------- records ---------------------------------- */

export type RecordRow = {
  id: number;
  student_id: string;
  course_name: string;
  learning_date: string;
  learning_minutes: number;
  chapters_done: number;
  total_chapters: number;
  quiz_score: number | null;
  created_at: string;
  course_id?: string;
};

export type RecordInput = {
  student_id: string;
  course_name: string;
  learning_date: string;
  learning_minutes: number;
  chapters_done: number;
  total_chapters: number;
  quiz_score: number | null;
};

export type RecordPatch = Partial<RecordInput>;

export type RecordsQuery = {
  course?: string;
  student?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type RecordsResponse = {
  total: number;
  limit: number;
  offset: number;
  rows: RecordRow[];
  hasMore?: boolean;
};

export type RecordMutationResponse = {
  ok: true;
  record: RecordRow;
  dataset: DatasetMeta;
};

export type RecordDeleteResponse = { ok: true; dataset: DatasetMeta };

export type RecordErrorResponse = {
  ok: false;
  notFound?: boolean;
  conflict?: boolean;
  errors: string[];
};

export type ImportResult = {
  ok: boolean;
  inserted: number;
  skipped: number;
  total: number;
  errors: string[];
  /** Snapshot of the pre-import dataset (F064). */
  snapshotId?: number | null;
  snapshotRowCount?: number | null;
  importId?: number | null;
};

export type ImportResponse = ImportResult & { dataset: DatasetMeta };
export type ResetResponse = ImportResponse;

/* ------------------------------- snapshots -------------------------------- */

export type DatasetSnapshot = {
  id: number;
  created_at: string;
  reason: string;
  row_count: number;
  actor_email: string | null;
};

export type DatasetSnapshotsResponse = { snapshots: DatasetSnapshot[] };

export type DatasetRestoreResponse = {
  ok: true;
  restored: number;
  snapshot: DatasetSnapshot;
  preRestoreSnapshot?: DatasetSnapshot;
  dataset: DatasetMeta;
};

/* ---------------------------------- admin ----------------------------------- */

export type AdminChapterRow = ChapterRow & {
  video_mode: VideoMode;
  video: CourseVideo | null;
};

export type AdminCourse = CourseMeta & {
  stats: CourseStats | null;
  chapterDetails: AdminChapterRow[];
};

export type AdminCoursesResponse = { courses: AdminCourse[] };

export type CourseVideoInput = {
  src: string;
  poster?: string;
  durationText?: string;
  note?: string;
};

export type CourseCreateBody = {
  name: string;
  category?: string;
  teacher?: string;
  level?: string;
  badge?: string;
  color?: string;
  intro?: string;
  sort_order?: number;
  video_mode?: VideoMode;
  video?: CourseVideoInput | null;
};

export type CourseUpdateBody = Partial<CourseCreateBody>;

export type CourseMutationResponse = { ok: true; course: CourseMeta };
export type CourseDeleteResponse = { ok: true; deletedRecords: number };

export type ChapterCreateBody = {
  title: string;
  body: string;
  video_mode?: VideoMode;
  video?: CourseVideoInput | null;
};
export type ChapterUpdateBody = Partial<ChapterCreateBody>;
export type ChapterMutationResponse = { ok: true; chapter: AdminChapterRow };
export type ChapterDeleteResponse = { ok: true };

/** Local form payload emitted by `ChapterDialog` (mirrors `ChapterCreateBody`). */
export type ChapterFormPayload = {
  title: string;
  body: string;
  video_mode: VideoMode;
  video: CourseVideoInput | null;
};

/* ----------------------------------- media ---------------------------------- */

export type MediaDriver = 'local' | 's3';

export type MediaPresignInput = {
  filename: string;
  contentType: string;
};

/** `POST /admin/media/presign`; `path` is the permanent site-local URL. */
export type MediaPresignResponse = {
  key: string;
  /** Presigned S3 PUT URL, or the local raw-upload endpoint. */
  uploadUrl: string;
  /** Absolute and possibly expiring; do not persist for course fields. */
  publicUrl: string;
  expiresIn: number;
  driver: MediaDriver;
  path: string;
};

/** `POST /admin/media/upload` (local driver only). */
export type MediaUploadResponse = {
  key: string;
  url: string;
  driver: 'local';
  path: string;
};

/** Normalised result emitted by `MediaUploader`; `path` is what fields store. */
export type MediaUploaded = {
  key: string;
  path: string;
  contentType: string;
  filename: string;
  size: number;
  driver: MediaDriver;
};

/* --------------------------- resumable uploads (F097) ---------------------- */

export type MediaUploadStatus = 'uploading' | 'completed' | 'aborted' | 'expired';

/** `POST /admin/media/uploads`. */
export type MediaUploadCreateInput = {
  filename: string;
  contentType: string;
  totalSize: number;
};

/**
 * `POST /admin/media/uploads` response. The API returns the session identity
 * and chunk plan; filename/contentType/totalSize are echoed by `GET` only.
 */
export type MediaUploadCreateResponse = {
  id: string;
  key: string;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  expiresAt: string;
  status: 'uploading';
};

/** `GET /admin/media/uploads/:id` — resumable session state. */
export type MediaUploadSession = {
  id: string;
  key: string;
  filename: string;
  contentType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  status: MediaUploadStatus;
  expiresAt: string;
};

/** `PUT /admin/media/uploads/:id/chunks/:index`. */
export type MediaUploadChunkResponse = {
  index: number;
  received: number;
  totalChunks: number;
};

/** `POST /admin/media/uploads/:id/complete`. */
export type MediaUploadCompleteResponse = {
  key: string;
  path: string;
  driver: MediaDriver;
  size: number;
};

/** `DELETE /admin/media/uploads/:id`. */
export type MediaUploadAbortResponse = { ok: true; status: 'aborted' };

/* ----------------------------- media library ------------------------------ */

/** A course/chapter field that still points at a media object. */
export type MediaReference = {
  type: 'course' | 'chapter';
  id: string;
  field: 'src' | 'poster';
};

/** `GET /admin/media` item. */
export type MediaObject = {
  key: string;
  path: string;
  size: number;
  lastModified: string;
  contentType: string;
  references: MediaReference[];
};

export type MediaLibraryQuery = { limit?: number; offset?: number };

export type MediaLibraryResponse = {
  total: number;
  limit: number;
  offset: number;
  items: MediaObject[];
};

/** `DELETE /admin/media/:key`; also the 409 payload's `references`. */
export type MediaDeleteResponse = {
  ok: true;
  key: string;
  references: MediaReference[];
};

export type MediaCleanupInput = { dryRun?: boolean; graceHours?: number };

export type MediaCleanupItem = {
  key: string;
  size: number;
  lastModified: string;
  reason: 'orphan' | 'expired-upload';
};

export type MediaCleanupError = { key: string; error: string };

/** `POST /admin/media/cleanup` (dry run populates `items` without deleting). */
export type MediaCleanupResult = {
  deleted: number;
  skippedReferenced: number;
  skippedYoung: number;
  errors: MediaCleanupError[];
  purgedUploads: number;
  items: MediaCleanupItem[];
};

export type AdminUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  email_verified: boolean;
  mfa_enabled: boolean;
  failed_attempts: number;
  /** Epoch milliseconds, matching the v1 column. */
  locked_until: number | null;
  created_at: string;
  last_login_at: string | null;
};

export type UsersResponse = { users: AdminUser[] };

export type CreateUserBody = {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  active?: boolean;
};

export type UpdateUserBody = {
  name?: string;
  role?: UserRole;
  active?: boolean;
  password?: string;
  unlock?: boolean;
  emailVerified?: boolean;
  resetMfa?: boolean;
};

export type UserMutationResponse = { ok: true; user: AdminUser };
export type UserErrorResponse = { ok: false; notFound?: boolean; errors: string[] };

export type AuditRow = {
  id: number;
  created_at: string;
  actor_user_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
};

export type AuditQuery = {
  limit?: number;
  offset?: number;
  action?: string;
};

export type AuditResponse = {
  total: number;
  limit: number;
  offset: number;
  rows: AuditRow[];
  hasMore?: boolean;
};