/**
 * Admin course/chapter calls that the shared endpoint map does not type fully.
 *
 * `CourseCreateBody` / `CourseUpdateBody` in `@/api/types` predate the three-state
 * `video_mode` field (F061 / ADR-008). The API accepts it, so these thin wrappers
 * call `apiRequest` directly with the richer body and keep the request typed
 * locally instead of editing the core API module.
 */
import { apiRequest } from '@/api/client';
import type {
  AdminCourse,
  AdminCoursesResponse,
  CourseDeleteResponse,
  CourseMutationResponse,
  CourseVideoInput,
  VideoMode,
} from '@/api/types';

export type AdminCoursePayload = {
  name: string;
  category?: string;
  teacher?: string;
  level?: string;
  badge?: string;
  color?: string;
  intro?: string;
  sort_order?: number;
  /** Three-state video mode (inherit / custom / none). */
  video_mode: VideoMode;
  /** Only meaningful when `video_mode === 'custom'`. */
  video?: CourseVideoInput | null;
};

export function listAdminCourses(): Promise<AdminCoursesResponse> {
  return apiRequest('/admin/courses');
}

export function createAdminCourse(body: AdminCoursePayload): Promise<CourseMutationResponse> {
  return apiRequest('/admin/courses', { method: 'POST', body });
}

export function updateAdminCourse(
  id: string,
  body: AdminCoursePayload,
): Promise<CourseMutationResponse> {
  return apiRequest(`/admin/courses/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

export function deleteAdminCourse(
  id: string,
  force = false,
): Promise<CourseDeleteResponse> {
  const suffix = force ? '?force=1' : '';
  return apiRequest(`/admin/courses/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE' });
}

/** Effective video state for a course row (legacy rows lack `video_mode`). */
export function courseVideoMode(course: AdminCourse | null): VideoMode {
  if (!course) return 'inherit';
  return course.video_mode ?? (course.video ? 'custom' : 'inherit');
}

export type VideoModeOption = {
  id: VideoMode;
  label: string;
  hint: string;
};

export const VIDEO_MODE_OPTIONS: VideoModeOption[] = [
  {
    id: 'inherit',
    label: '继承默认示例视频',
    hint: '使用课程包内置的导览视频；新建课程会使用共享示例片段。',
  },
  {
    id: 'custom',
    label: '自定义视频',
    hint: '填写站内路径（以 / 开头），可为课程单独替换视频与封面。',
  },
  {
    id: 'none',
    label: '不显示视频',
    hint: '课程详情与章节页不展示视频区域。',
  },
];