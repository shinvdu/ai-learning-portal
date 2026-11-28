<script setup lang="ts">
/**
 * Admin media uploader (F095/F096/F097).
 *
 * Every file now goes through the chunked/resumable upload API:
 * create session → PUT `uploadedChunks`-minus chunks (2 at a time) → complete.
 * The legacy single-request presign/raw upload (50 MiB cap) stays available in
 * `mediaApi` for compatibility, but the UI no longer uses it, so the effective
 * size limit is the server's `MEDIA_MAX_BYTES` (2 GiB by default).
 *
 * Resume state (session id, keyed by filename+size+lastModified) lives in
 * `localStorage`, so reloading/crashing mid-upload skips finished chunks. A
 * missing/expired session transparently creates a fresh one; cancel aborts the
 * session and removes its staged chunks.
 *
 * The component never persists `publicUrl` (absolute + expiring); it emits the
 * permanent site-local `path` (`/api/v1/media/<key>`) for form fields.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { ApiError, MEDIA_MAX_BYTES, errorMessage } from '@/api/client';
import { mediaUploadApi } from '@/api/endpoints';
import type { MediaUploadCompleteResponse, MediaUploaded } from '@/api/types';
import { useToastStore } from '@/stores/toast';
import AppButton from '@/components/ui/AppButton.vue';

const props = withDefaults(
  defineProps<{
    kind: 'video' | 'image';
    label?: string;
    hint?: string;
    disabled?: boolean;
    maxBytes?: number;
  }>(),
  { maxBytes: MEDIA_MAX_BYTES },
);

const emit = defineEmits<{
  uploaded: [payload: MediaUploaded];
  uploading: [value: boolean];
}>();

const toast = useToastStore();

/** Max parallel chunk PUTs; keeps large uploads moving without flooding. */
const MAX_PARALLEL_CHUNKS = 2;
const RESUME_PREFIX = 'portal:media-upload:';

type ActiveSession = {
  id: string;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
};

const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const dragActive = ref(false);
const progress = ref<number | null>(null);
const chunksDone = ref(0);
const totalChunks = ref(0);
const speedText = ref('');
const error = ref('');
const previewUrl = ref('');
const previewName = ref('');
const previewIsVideo = ref(false);
const pendingFile = ref<File | null>(null);

let controller: AbortController | null = null;
let disposed = false;

const kindLabel = computed(() => (props.kind === 'video' ? '视频' : '图片'));
const accept = computed(() => (props.kind === 'video' ? 'video/*' : 'image/*'));
const canRetry = computed(() => !busy.value && pendingFile.value !== null && error.value !== '');

const EXT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'ogv', 'ogg', 'mov', 'avi', 'mkv']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg']);

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function contentTypeOf(file: File): string {
  const declared = (file.type || '').trim();
  if (declared && declared !== 'application/octet-stream') return declared;
  return EXT_TYPES[extensionOf(file.name)] ?? 'application/octet-stream';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function typeMatches(file: File): boolean {
  const declared = (file.type || '').toLowerCase();
  if (declared && declared !== 'application/octet-stream') {
    return declared.startsWith(props.kind === 'video' ? 'video/' : 'image/');
  }
  const ext = extensionOf(file.name);
  return props.kind === 'video' ? VIDEO_EXTS.has(ext) : IMAGE_EXTS.has(ext);
}

/* ------------------------------- resume state ------------------------------ */

function resumeKey(file: File): string {
  return `${RESUME_PREFIX}${file.name}:${file.size}:${file.lastModified}`;
}

function readResumeId(key: string): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    const raw = localStorage.getItem(key);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed?.id === 'string' ? parsed.id : '';
  } catch {
    return '';
  }
}

function storeResumeId(key: string, id: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify({ id }));
  } catch {
    /* private mode / quota: resuming is a nicety, not a requirement */
  }
}

function forgetResume(key: string): void {
  try {
    if (typeof localStorage !== 'undefined' && key) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/* -------------------------------- preview ---------------------------------- */

function clearPreview(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  previewName.value = '';
}

function showPreview(file: File): void {
  clearPreview();
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  previewUrl.value = URL.createObjectURL(file);
  previewName.value = file.name;
  previewIsVideo.value = props.kind === 'video';
}

function friendlyError(thrown: unknown): string {
  if (thrown instanceof ApiError) {
    if (thrown.status === 413) {
      const detail = thrown.message && !thrown.message.includes('<') ? thrown.message : '';
      return detail
        ? `${detail}（上限 ${formatBytes(props.maxBytes)}）`
        : `文件超过大小上限（${formatBytes(props.maxBytes)}），请压缩后再上传。`;
    }
    if (thrown.status === 403) {
      return '上传被拒绝（403）：登录可能已过期，请刷新页面后重试。';
    }
    if (thrown.status === 401) return '登录已过期，请重新登录后再上传。';
    if (thrown.status === 409) {
      return `${thrown.message || '上传会话已失效'}；点击「重试」将重新开始上传。`;
    }
    if (thrown.status === 404) return '上传会话已不存在；点击「重试」将重新开始上传。';
    return thrown.message;
  }
  const message = errorMessage(thrown, '上传失败，请稍后重试');
  if (/failed to fetch|networkerror|cors/i.test(message)) {
    return '上传失败：无法连接到服务器，请检查网络后点击「重试」断点续传。';
  }
  return message;
}

/* -------------------------------- progress --------------------------------- */

function chunkLength(index: number, fileSize: number, chunkSize: number, total: number): number {
  return index === total - 1 ? fileSize - chunkSize * (total - 1) : chunkSize;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function idle(): void {
  speedText.value = '';
}

function reset(): void {
  error.value = '';
  progress.value = null;
  chunksDone.value = 0;
  totalChunks.value = 0;
  idle();
}

/* --------------------------------- upload ---------------------------------- */

async function runUpload(file: File): Promise<void> {
  reset();
  pendingFile.value = file;
  busy.value = true;
  emit('uploading', true);
  progress.value = 0;

  const contentType = contentTypeOf(file);
  const cacheKey = resumeKey(file);
  const signal = new AbortController();
  controller = signal;
  let session: ActiveSession | null = null;
  let attemptBytes = 0;
  let startedAt = 0;

  const onChunkProgress = (
    index: number,
    loaded: number,
    loadedByChunk: Map<number, number>,
  ): void => {
    if (loaded > (loadedByChunk.get(index) ?? 0)) {
      attemptBytes += loaded - (loadedByChunk.get(index) ?? 0);
      if (startedAt === 0) startedAt = performance.now();
      const elapsed = (performance.now() - startedAt) / 1000;
      if (elapsed > 0.3) {
        speedText.value = `${(attemptBytes / 1048576 / elapsed).toFixed(1)} MB/s`;
      }
    }
    loadedByChunk.set(index, loaded);
  };

  const overall = (done: Set<number>, loadedByChunk: Map<number, number>): number => {
    let moved = 0;
    for (let index = 0; index < session!.totalChunks; index += 1) {
      const expected = chunkLength(index, file.size, session!.chunkSize, session!.totalChunks);
      moved += done.has(index)
        ? expected
        : Math.min(loadedByChunk.get(index) ?? 0, expected);
    }
    if (file.size <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((moved / file.size) * 100)));
  };

  const savedId = readResumeId(cacheKey);

  try {
    // 1) Resume an existing session when possible.
    if (savedId) {
      try {
        const existing = await mediaUploadApi.getUpload(savedId, { signal: signal.signal });
        if (existing.status === 'completed') {
          const done = await mediaUploadApi.completeUpload(existing.id);
          forgetResume(cacheKey);
          finish(done, file, contentType);
          return;
        }
        const fresh =
          existing.status === 'uploading' &&
          new Date(existing.expiresAt).getTime() > Date.now();
        if (fresh) {
          session = {
            id: existing.id,
            chunkSize: existing.chunkSize,
            totalChunks: existing.totalChunks,
            uploadedChunks: existing.uploadedChunks,
          };
        } else {
          forgetResume(cacheKey);
          void mediaUploadApi.abortUpload(existing.id).catch(() => undefined);
        }
      } catch (thrown) {
        if (thrown instanceof ApiError && thrown.status === 404) {
          forgetResume(cacheKey);
        } else {
          throw thrown;
        }
      }
    }

    // 2) Otherwise create a new session.
    if (!session) {
      const created = await mediaUploadApi.createUpload(
        { filename: file.name, contentType, totalSize: file.size },
        { signal: signal.signal },
      );
      session = {
        id: created.id,
        chunkSize: created.chunkSize,
        totalChunks: created.totalChunks,
        uploadedChunks: created.uploadedChunks,
      };
      storeResumeId(cacheKey, created.id);
    }

    const active = session;
    totalChunks.value = active.totalChunks;
    const done = new Set<number>();
    for (const index of active.uploadedChunks) {
      if (Number.isInteger(index) && index >= 0 && index < active.totalChunks) done.add(index);
    }
    chunksDone.value = done.size;
    const loadedByChunk = new Map<number, number>();
    progress.value = overall(done, loadedByChunk);

    // 3) Upload every missing chunk, two at a time. `done` and the server's
    //    chunk list are the source of truth, so a retried file skips pieces
    //    already staged on the API host.
    const queue: number[] = [];
    for (let index = 0; index < active.totalChunks; index += 1) {
      if (!done.has(index)) queue.push(index);
    }
    let cursor = 0;

    const sendChunk = async (index: number): Promise<void> => {
      const start = index * active.chunkSize;
      const end = Math.min(file.size, start + active.chunkSize);
      const blob = file.slice(start, end);
      let attempts = 0;
      for (;;) {
        try {
          await mediaUploadApi.putChunk(active.id, index, blob, {
            signal: signal.signal,
            onProgress: (event) => {
              onChunkProgress(index, event.loaded, loadedByChunk);
              progress.value = overall(done, loadedByChunk);
            },
          });
          return;
        } catch (thrown) {
          attempts += 1;
          const retryable =
            !signal.signal.aborted &&
            thrown instanceof ApiError &&
            (thrown.status === 0 || thrown.status === 429 || thrown.status >= 500);
          if (!retryable || attempts >= 2) throw thrown;
          await delay(700);
        }
      }
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const index = queue[cursor];
        cursor += 1;
        if (index === undefined) return;
        await sendChunk(index);
        loadedByChunk.delete(index);
        done.add(index);
        chunksDone.value = done.size;
        progress.value = overall(done, loadedByChunk);
      }
    };

    const workerCount = Math.min(MAX_PARALLEL_CHUNKS, queue.length);
    if (workerCount > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }
    if (signal.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // 4) Assemble + persist.
    const completed = await mediaUploadApi.completeUpload(active.id);
    forgetResume(cacheKey);
    finish(completed, file, contentType);
  } catch (thrown) {
    const aborted = thrown instanceof DOMException && thrown.name === 'AbortError';
    if (aborted) {
      const idToAbort = session?.id || savedId;
      if (idToAbort) {
        await mediaUploadApi.abortUpload(idToAbort).catch(() => undefined);
      }
      forgetResume(cacheKey);
      if (!disposed) {
        pendingFile.value = null;
        error.value = '';
        progress.value = null;
        toast.info('已取消上传');
      }
      return;
    }

    // Stop any sibling chunk worker still in flight before surfacing the error.
    signal.abort();
    if (thrown instanceof ApiError && (thrown.status === 404 || thrown.status === 409)) {
      forgetResume(cacheKey);
    }
    if (!disposed) {
      error.value = friendlyError(thrown);
      progress.value = null;
      toast.error(error.value);
    }
  } finally {
    controller = null;
    idle();
    busy.value = false;
    if (!disposed) emit('uploading', false);
  }
}

function finish(
  completed: MediaUploadCompleteResponse,
  file: File,
  contentType: string,
): void {
  progress.value = 100;
  chunksDone.value = totalChunks.value;
  pendingFile.value = null;
  if (!disposed) {
    toast.ok(`${kindLabel.value}已上传`);
    emit('uploaded', {
      key: completed.key,
      path: completed.path,
      contentType,
      filename: file.name,
      size: completed.size || file.size,
      driver: completed.driver,
    });
  }
}

function upload(file: File): void {
  reset();

  if (props.disabled || busy.value) return;
  if (!typeMatches(file)) {
    error.value = `请选择${kindLabel.value}文件（${accept.value}）。`;
    toast.error(error.value);
    return;
  }
  if (file.size > props.maxBytes) {
    error.value = `文件超过 ${formatBytes(props.maxBytes)}，请压缩后再上传。`;
    toast.error(error.value);
    return;
  }
  if (file.size === 0) {
    error.value = '文件内容为空，请重新选择。';
    toast.error(error.value);
    return;
  }

  showPreview(file);
  void runUpload(file);
}

function retry(): void {
  const file = pendingFile.value;
  if (!file || busy.value) return;
  void runUpload(file);
}

function cancel(): void {
  if (!busy.value) return;
  controller?.abort();
}

function choose(): void {
  if (props.disabled || busy.value) return;
  input.value?.click();
}

function onInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (file) upload(file);
}

function onDrop(event: DragEvent): void {
  dragActive.value = false;
  if (props.disabled || busy.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) upload(file);
}

function setDrag(event: DragEvent, active: boolean): void {
  event.preventDefault();
  if (props.disabled || busy.value) return;
  dragActive.value = active;
}

onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
  clearPreview();
});
</script>

<template>
  <div class="media-uploader">
    <span class="field-label">{{ label ?? `${kindLabel}文件` }}</span>

    <div
      class="uploader-drop"
      :class="{ 'is-active': dragActive, 'is-busy': busy }"
      @dragenter="setDrag($event, true)"
      @dragover="setDrag($event, true)"
      @dragleave="setDrag($event, false)"
      @drop="onDrop"
    >
      <input
        ref="input"
        class="uploader-input"
        type="file"
        :accept="accept"
        :disabled="disabled || busy"
        :aria-label="`选择${kindLabel}文件`"
        @change="onInputChange"
      />
      <AppButton size="sm" variant="ghost" :disabled="disabled || busy" @click="choose">
        {{ busy ? '上传中…' : `选择${kindLabel}` }}
      </AppButton>
      <p class="uploader-help">
        或拖拽{{ kindLabel }}到此处。支持 {{ accept }}，不超过 {{ formatBytes(maxBytes) }}；大文件自动分片并支持断点续传。
      </p>
    </div>

    <p v-if="hint" class="field-hint">{{ hint }}</p>

    <div v-if="busy || progress !== null" class="uploader-progress">
      <div
        class="uploader-progress-track"
        role="progressbar"
        :aria-label="`${kindLabel}上传进度`"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progress ?? 0"
        :aria-valuetext="progress === null ? '准备上传' : `${progress}%`"
      >
        <span
          class="uploader-progress-fill"
          :style="progress !== null ? { width: `${progress}%` } : undefined"
        />
      </div>
      <span class="uploader-progress-text" aria-live="polite">
        <template v-if="progress === null">准备上传…</template>
        <template v-else>
          已上传 {{ progress }}%<template v-if="totalChunks > 1">（分片 {{ chunksDone }}/{{ totalChunks }}）</template>
        </template>
      </span>
      <AppButton v-if="busy" size="sm" variant="ghost" @click="cancel">取消</AppButton>
    </div>

    <div v-if="busy && speedText" class="uploader-speed" aria-live="off">
      当前速度 {{ speedText }}
    </div>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>

    <div v-if="canRetry" class="uploader-retry">
      <AppButton size="sm" variant="light" @click="retry">重试（断点续传）</AppButton>
      <span class="uploader-help">已上传的分片会被跳过。</span>
    </div>

    <p v-if="previewUrl && !busy" class="uploader-done" aria-live="polite">
      已选择：{{ previewName }}
    </p>

    <div v-if="previewUrl" class="uploader-preview">
      <video
        v-if="previewIsVideo"
        :src="previewUrl"
        controls
        preload="metadata"
        :aria-label="`${kindLabel}预览`"
      />
      <img v-else :src="previewUrl" :alt="`${kindLabel}预览`" />
    </div>
  </div>
</template>

<style scoped>
.media-uploader {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.uploader-drop {
  border: 1px dashed var(--line-strong);
  background: #f8fafd;
  border-radius: var(--radius-xs);
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  transition: border-color 0.15s, background 0.15s;
}

.uploader-drop.is-active {
  border-color: var(--teal);
  background: #eefbfb;
}

.uploader-drop.is-busy {
  opacity: 0.72;
}

.uploader-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.uploader-help {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}

.uploader-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.uploader-progress-track {
  flex: 1;
  height: 7px;
  border-radius: 999px;
  background: #e8edf5;
  overflow: hidden;
}

.uploader-progress-fill {
  display: block;
  height: 100%;
  background: var(--teal);
  border-radius: inherit;
  transition: width 0.18s ease;
}

.uploader-progress-text {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.uploader-speed {
  font-size: 12px;
  color: var(--muted);
}

.uploader-retry {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.uploader-done {
  margin: 0;
  font-size: 12px;
  color: var(--teal-ink);
}

.uploader-preview {
  border-radius: var(--radius-xs);
  overflow: hidden;
  background: #000;
  border: 1px solid var(--line);
  max-width: 320px;
}

.uploader-preview video,
.uploader-preview img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 180px;
  object-fit: cover;
}
</style>