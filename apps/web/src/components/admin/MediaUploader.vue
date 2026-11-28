<script setup lang="ts">
/**
 * Admin media uploader (F095/F096).
 *
 * Flow: client-side size/type check → `POST /admin/media/presign` →
 * local driver: raw `POST /admin/media/upload` with CSRF; S3 driver: direct
 * presigned `PUT` with credentials omitted (the browser must be allowed by
 * the bucket/MinIO CORS policy).
 *
 * The component never persists `publicUrl` (absolute + expiring); it emits the
 * permanent site-local `path` (`/api/v1/media/<key>`) for form fields.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { ApiError, MEDIA_MAX_BYTES, errorMessage, uploadBinary } from '@/api/client';
import { mediaApi } from '@/api/endpoints';
import type { MediaUploaded } from '@/api/types';
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

const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const dragActive = ref(false);
const progress = ref<number | null>(null);
const error = ref('');
const previewUrl = ref('');
const previewName = ref('');
const previewIsVideo = ref(false);

const kindLabel = computed(() => (props.kind === 'video' ? '视频' : '图片'));
const accept = computed(() => (props.kind === 'video' ? 'video/*' : 'image/*'));

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
      return '上传被拒绝（403）：登录可能已过期，或对象存储预签名已失效，请重试。';
    }
    if (thrown.status === 401) return '登录已过期，请重新登录后再上传。';
    return thrown.message;
  }
  const message = errorMessage(thrown, '上传失败，请稍后重试');
  if (/failed to fetch|networkerror|cors/i.test(message)) {
    return '上传失败：无法连接到存储服务，请检查网络或对象存储 CORS 配置。';
  }
  return message;
}

function reset(): void {
  error.value = '';
  progress.value = null;
}

async function upload(file: File): Promise<void> {
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
  busy.value = true;
  emit('uploading', true);
  progress.value = 0;

  const contentType = contentTypeOf(file);
  try {
    const presign = await mediaApi.presign({ filename: file.name, contentType });
    const onProgress = (event: { percent: number | null }): void => {
      progress.value = event.percent;
    };

    if (presign.driver === 's3') {
      // Direct browser PUT: no cookies/CSRF, Content-Type must match the
      // signature exactly. Cross-origin requires bucket CORS.
      await uploadBinary(presign.uploadUrl, file, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        credentials: 'omit',
        onProgress,
      });
    } else {
      await mediaApi.uploadLocal({
        key: presign.key,
        filename: file.name,
        file,
        contentType,
        onProgress,
      });
    }

    const path = presign.path || mediaApi.mediaPath(presign.key);
    progress.value = 100;
    toast.ok(`${kindLabel.value}已上传`);
    emit('uploaded', {
      key: presign.key,
      path,
      contentType,
      filename: file.name,
      size: file.size,
      driver: presign.driver,
    });
  } catch (thrown) {
    error.value = friendlyError(thrown);
    progress.value = null;
    toast.error(error.value);
  } finally {
    busy.value = false;
    emit('uploading', false);
  }
}

function choose(): void {
  if (props.disabled || busy.value) return;
  input.value?.click();
}

function onInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (file) void upload(file);
}

function onDrop(event: DragEvent): void {
  dragActive.value = false;
  if (props.disabled || busy.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) void upload(file);
}

function setDrag(event: DragEvent, active: boolean): void {
  event.preventDefault();
  if (props.disabled || busy.value) return;
  dragActive.value = active;
}

onBeforeUnmount(clearPreview);
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
      <p class="uploader-help">或拖拽{{ kindLabel }}到此处。支持 {{ accept }}，不超过 {{ formatBytes(maxBytes) }}。</p>
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
        :aria-valuetext="progress === null ? '上传中' : `${progress}%`"
      >
        <span
          class="uploader-progress-fill"
          :class="{ indeterminate: progress === null }"
          :style="progress !== null ? { width: `${progress}%` } : undefined"
        />
      </div>
      <span class="uploader-progress-text" aria-live="polite">
        {{ progress === null ? '上传中…' : `已上传 ${progress}%` }}
      </span>
    </div>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>

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

.uploader-progress-fill.indeterminate {
  width: 35%;
  animation: uploader-pulse 1.1s ease-in-out infinite;
}

.uploader-progress-text {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
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

@keyframes uploader-pulse {
  0% {
    margin-left: 0;
  }
  50% {
    margin-left: 65%;
  }
  100% {
    margin-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .uploader-progress-fill.indeterminate {
    animation: none;
    width: 100%;
  }
}
</style>