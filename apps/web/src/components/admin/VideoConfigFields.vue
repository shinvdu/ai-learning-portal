<script setup lang="ts">
/**
 * Shared three-state video editor for courses and chapters (F061/F095/F096).
 *
 * `mode` is `inherit` / `custom` / `none`. For `custom`, the admin either
 * uploads a file (MediaUploader → local raw upload or S3 presigned PUT) or
 * pastes a site-local URL. Both paths keep `src`/`poster` as
 * `/api/v1/media/<key>` or another site-local path — external absolute URLs
 * are rejected by the API.
 */
import { computed, ref, useId, watch } from 'vue';
import type { MediaUploaded, VideoMode } from '@/api/types';
import AppInput from '@/components/ui/AppInput.vue';
import MediaUploader from './MediaUploader.vue';

type ModeOption = { id: VideoMode; label: string; hint: string };

const props = withDefaults(
  defineProps<{
    context?: 'course' | 'chapter';
    disabled?: boolean;
    srcError?: string;
    posterError?: string;
    durationError?: string;
    noteError?: string;
  }>(),
  { context: 'course' },
);

const emit = defineEmits<{ uploading: [value: boolean] }>();

const mode = defineModel<VideoMode>('mode', { required: true });
const source = defineModel<'upload' | 'url'>('source', { default: 'upload' });
const src = defineModel<string>('src', { default: '' });
const poster = defineModel<string>('poster', { default: '' });
const durationText = defineModel<string>('durationText', { default: '' });
const note = defineModel<string>('note', { default: '' });

const uid = useId();
const modeName = `video-mode-${uid}`;
const sourceName = `video-source-${uid}`;

const COURSE_MODE_OPTIONS: ModeOption[] = [
  {
    id: 'inherit',
    label: '继承默认示例视频',
    hint: '使用课程包内置的导览视频；新建课程会使用共享示例片段。',
  },
  {
    id: 'custom',
    label: '自定义视频',
    hint: '上传文件或填写站内路径，可为课程单独替换视频与封面。',
  },
  {
    id: 'none',
    label: '不显示视频',
    hint: '课程详情与章节页不展示视频区域。',
  },
];

const CHAPTER_MODE_OPTIONS: ModeOption[] = [
  {
    id: 'inherit',
    label: '继承课程视频',
    hint: '使用课程导览视频；课程未配置视频时本章不显示。',
  },
  {
    id: 'custom',
    label: '自定义本章视频',
    hint: '上传文件或填写站内路径，只影响当前章节。',
  },
  {
    id: 'none',
    label: '不显示视频',
    hint: '章节页显示“本章暂无视频”，保留讲义与测验。',
  },
];

const modeOptions = computed<ModeOption[]>(() =>
  props.context === 'chapter' ? CHAPTER_MODE_OPTIONS : COURSE_MODE_OPTIONS,
);

const legend = computed(() => (props.context === 'chapter' ? '本章视频' : '课程视频'));
const srcLabel = computed(() =>
  props.context === 'chapter' ? '视频地址（站内）' : '视频地址',
);

const lastAutoDuration = ref('');
const previewError = ref(false);
const videoUploading = ref(false);
const posterUploading = ref(false);

watch(
  [videoUploading, posterUploading],
  ([video, image]) => emit('uploading', video || image),
);

watch(src, () => {
  previewError.value = false;
});

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
  }
  if (minutes > 0) return `${minutes}:${String(remain).padStart(2, '0')}`;
  return `${remain} 秒`;
}

/** API defaults that should be replaced by the real media duration. */
const AUTO_DURATION_PLACEHOLDERS = new Set(['', '示例视频']);

/** Fill the editable duration text once the media metadata is available. */
function onLoadedMetadata(event: Event): void {
  const element = event.target as HTMLVideoElement | null;
  if (!element) return;
  const text = formatDuration(element.duration);
  if (!text) return;
  const current = durationText.value.trim();
  if (AUTO_DURATION_PLACEHOLDERS.has(current) || durationText.value === lastAutoDuration.value) {
    durationText.value = text;
    lastAutoDuration.value = text;
  }
}

function onVideoUploaded(payload: MediaUploaded): void {
  src.value = payload.path;
  previewError.value = false;
}

function onPosterUploaded(payload: MediaUploaded): void {
  poster.value = payload.path;
}

function clearSource(): void {
  source.value = 'upload';
  src.value = '';
  poster.value = '';
  previewError.value = false;
}
</script>

<template>
  <div class="video-config">
    <fieldset class="video-modes">
      <legend>{{ legend }}</legend>
      <label v-for="option in modeOptions" :key="option.id" class="video-mode">
        <input
          type="radio"
          :name="modeName"
          :value="option.id"
          :checked="mode === option.id"
          :disabled="disabled"
          @change="mode = option.id"
        />
        <span>
          <strong>{{ option.label }}</strong>
          <small>{{ option.hint }}</small>
        </span>
      </label>
    </fieldset>

    <template v-if="mode === 'custom'">
      <div class="source-choice" role="radiogroup" aria-label="自定义视频来源">
        <label class="source-option">
          <input
            v-model="source"
            type="radio"
            :name="sourceName"
            value="upload"
            :disabled="disabled"
          />
          上传文件
        </label>
        <label class="source-option">
          <input
            v-model="source"
            type="radio"
            :name="sourceName"
            value="url"
            :disabled="disabled"
          />
          手动 URL
        </label>
      </div>

      <div v-if="source === 'upload'" class="form-grid video-fields">
        <div class="span-2">
          <MediaUploader
            kind="video"
            label="视频文件"
            hint="上传后保存为站内地址 /api/v1/media/<key>，不会写入外部绝对地址。"
            :disabled="disabled"
            @uploaded="onVideoUploaded"
            @uploading="videoUploading = $event"
          />
          <span v-if="srcError" class="field-error" role="alert">{{ srcError }}</span>
        </div>
        <div class="span-2">
          <MediaUploader
            kind="image"
            label="封面图片（可选）"
            hint="建议 16:9；上传后保存为站内地址。"
            :disabled="disabled"
            @uploaded="onPosterUploaded"
            @uploading="posterUploading = $event"
          />
          <span v-if="posterError" class="field-error" role="alert">{{ posterError }}</span>
        </div>
      </div>

      <div v-else class="form-grid video-fields">
        <AppInput
          v-model="src"
          :label="srcLabel"
          required
          :maxlength="500"
          placeholder="/api/v1/media/abc123.mp4"
          hint="必须是以 / 开头的站内路径（上传后会自动填入）。"
          :disabled="disabled"
          :error="srcError"
        />
        <AppInput
          v-model="poster"
          label="封面地址"
          :maxlength="500"
          placeholder="/api/v1/media/abc123.jpg"
          hint="可选，同样必须是站内路径。"
          :disabled="disabled"
          :error="posterError"
        />
      </div>

      <div class="form-grid video-fields">
        <AppInput
          v-model="durationText"
          label="时长文本"
          :maxlength="40"
          placeholder="自动读取，例如 1:24"
          hint="视频元数据加载后自动填写，可手动修改。"
          :disabled="disabled"
          :error="durationError"
        />
        <AppInput
          v-model="note"
          :label="context === 'chapter' ? '备注（可选）' : '备注'"
          :maxlength="200"
          :placeholder="context === 'chapter' ? '第 3 章导览视频。' : '示例视频，可在后台替换。'"
          :disabled="disabled"
          :error="noteError"
        />
      </div>

      <div v-if="src" class="video-preview-block">
        <div class="video-preview-head">
          <span class="field-label">当前预览</span>
          <button
            type="button"
            class="btn-link"
            :disabled="disabled"
            @click="clearSource"
          >
            清除已选视频
          </button>
        </div>
        <video
          v-if="!previewError"
          class="video-preview"
          :src="src"
          :poster="poster || undefined"
          controls
          preload="metadata"
          @loadedmetadata="onLoadedMetadata"
          @error="previewError = true"
        />
        <p v-else class="field-error" role="alert">
          视频无法预览，请确认地址可访问或以 / 开头。
        </p>
        <img
          v-if="poster && !previewError"
          class="poster-preview"
          :src="poster"
          alt="视频封面预览"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.video-config {
  margin-top: 4px;
}

.video-modes {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px 14px;
  margin: 16px 0 0;
}

.video-modes legend {
  padding: 0 6px;
  font-size: 12.5px;
  font-weight: 700;
  color: #4b5568;
}

.video-mode {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 4px;
  font-size: 13px;
  font-weight: 400;
  color: var(--ink);
  cursor: pointer;
}

.video-mode input {
  width: 16px;
  height: 16px;
  min-height: 0;
  margin-top: 3px;
  accent-color: var(--teal);
}

.video-mode strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
}

.video-mode small {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.source-choice {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.source-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  color: #4b5568;
  cursor: pointer;
}

.source-option input {
  width: 15px;
  height: 15px;
  min-height: 0;
  accent-color: var(--teal);
}

.video-fields {
  margin-top: 14px;
}

.span-2 {
  grid-column: 1 / -1;
}

.video-preview-block {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}

.video-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.video-preview {
  display: block;
  width: min(100%, 340px);
  border-radius: var(--radius-xs);
  background: #000;
  border: 1px solid var(--line);
}

.poster-preview {
  display: block;
  width: min(160px, 40%);
  margin-top: 8px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--line);
}
</style>