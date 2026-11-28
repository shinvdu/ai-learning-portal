/**
 * Shared three-state video validation (ADR-008, F061/F096).
 *
 * Courses and chapters both store `video_mode` (`inherit` | `custom` | `none`)
 * plus an optional `video` JSONB payload. The database check constraint keeps
 * `custom ⇔ video is not null`, so these helpers must always return a mode and
 * payload pair that satisfies it.
 *
 * Only site-local paths are accepted: anything starting with `/` (but not
 * `//`), without `..` or backslashes. That includes media API paths such as
 * `/api/v1/media/<key>`; external/absolute URLs are rejected.
 */
import type { CourseVideo, VideoMode } from '@portal/db';

export const SAFE_LOCAL_PATH = (value: string): boolean =>
  value === '' || (/^\/(?!\/)/.test(value) && !value.includes('..') && !value.includes('\\'));

export const VIDEO_MODES: readonly VideoMode[] = ['inherit', 'custom', 'none'];

export type VideoResolution = { errors: string[]; mode?: VideoMode; video?: CourseVideo | null };

export function normalizeVideoPayload(value: unknown): {
  errors: string[];
  video: CourseVideo | null;
} {
  // A `custom` mode always needs a payload: the DB check constraint requires
  // `video is not null`, so `null`/missing here must be a 400, not a 500.
  if (value === null || value === undefined) {
    return { errors: ['视频 src 不能为空'], video: null };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { errors: ['视频 src 不能为空'], video: null };
  }
  const input = value as Record<string, unknown>;
  const src = String(input.src ?? '').trim();
  const poster = String(input.poster ?? '').trim();
  if (!src) return { errors: ['视频 src 不能为空'], video: null };
  if (!SAFE_LOCAL_PATH(src) || !SAFE_LOCAL_PATH(poster)) {
    return { errors: ['视频与封面必须使用站内路径（以 / 开头）'], video: null };
  }
  return {
    errors: [],
    video: {
      src: src.slice(0, 500),
      poster: poster.slice(0, 500),
      durationText: String(input.durationText ?? '示例视频').trim().slice(0, 40),
      label: '课程导览视频',
      note: String(input.note ?? '示例视频，可在后台替换。').trim().slice(0, 200),
      isPlaceholder: true,
    },
  };
}

export function readMode(value: unknown): { errors: string[]; mode?: VideoMode } {
  if (value === undefined) return { errors: [] };
  if (typeof value === 'string' && (VIDEO_MODES as readonly string[]).includes(value)) {
    return { errors: [], mode: value as VideoMode };
  }
  return { errors: ['video_mode 只能是 inherit、custom 或 none'] };
}

/**
 * Create-time three-state resolution. Without an explicit mode, a supplied
 * payload means `custom`; otherwise the `defaultMode` applies — `none` for
 * courses (v1 behaviour) and `inherit` for chapters.
 */
export function resolveCreateVideo(
  input: Record<string, unknown>,
  defaultMode: VideoMode = 'none',
): VideoResolution {
  const modeResult = readMode(input.video_mode);
  if (modeResult.errors.length > 0) return { errors: modeResult.errors };
  let mode: VideoMode;
  if (modeResult.mode) mode = modeResult.mode;
  else if (input.video !== undefined && input.video !== null) mode = 'custom';
  else mode = defaultMode;

  if (mode === 'custom') {
    const payload = normalizeVideoPayload(input.video);
    if (payload.errors.length > 0) return { errors: payload.errors };
    return { errors: [], mode, video: payload.video };
  }
  return { errors: [], mode, video: null };
}

export type UpdateVideoState = {
  existingMode: VideoMode;
  existingVideo: CourseVideo | null;
};

export function resolveUpdateVideo(
  input: Record<string, unknown>,
  state: UpdateVideoState,
): VideoResolution {
  const hasMode = input.video_mode !== undefined;
  const hasVideo = input.video !== undefined;
  if (!hasMode && !hasVideo) return { errors: [] };

  const modeResult = readMode(input.video_mode);
  if (modeResult.errors.length > 0) return { errors: modeResult.errors };

  let mode: VideoMode;
  if (modeResult.mode) mode = modeResult.mode;
  else if (input.video === null) mode = 'none';
  else mode = 'custom';

  if (mode === 'custom') {
    if (hasVideo) {
      const payload = normalizeVideoPayload(input.video);
      if (payload.errors.length > 0) return { errors: payload.errors };
      return { errors: [], mode, video: payload.video };
    }
    if (state.existingMode === 'custom' && state.existingVideo) {
      return { errors: [], mode, video: state.existingVideo };
    }
    return { errors: ['视频 src 不能为空'] };
  }

  return { errors: [], mode, video: null };
}