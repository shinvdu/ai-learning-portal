<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import type {
  AdminChapterRow,
  ChapterFormPayload,
  CourseVideoInput,
  VideoMode,
} from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';
import AppDialog from '@/components/ui/AppDialog.vue';
import AppInput from '@/components/ui/AppInput.vue';
import VideoConfigFields from './VideoConfigFields.vue';

const props = defineProps<{
  open: boolean;
  /** Chapter being edited, or null when appending a new chapter. */
  chapter: AdminChapterRow | null;
  /** Index the next appended chapter will receive (add mode hint). */
  nextIdx: number;
  busy: boolean;
  serverError: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  submit: [payload: ChapterFormPayload];
}>();

const title = ref('');
const body = ref('');
const videoMode = ref<VideoMode>('inherit');
const videoSource = ref<'upload' | 'url'>('upload');
const videoSrc = ref('');
const videoPoster = ref('');
const videoDuration = ref('');
const videoNote = ref('');
const uploading = ref(false);

const fieldErrors = reactive<{
  title?: string;
  body?: string;
  videoSrc?: string;
  videoPoster?: string;
  videoDuration?: string;
  videoNote?: string;
}>({});
const bodyId = useId();
const bodyErrorId = `${bodyId}-error`;

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const dialogTitle = computed(() =>
  props.chapter ? `编辑第 ${props.chapter.idx} 章` : '新增章节',
);

function videoSourceOf(video: { src?: string | null } | null | undefined): 'upload' | 'url' {
  return video?.src?.startsWith('/api/v1/media/') ? 'upload' : 'url';
}

watch(
  () => [props.open, props.chapter] as const,
  ([open]) => {
    if (!open) return;
    const chapter = props.chapter;
    title.value = chapter?.title ?? '';
    body.value = chapter?.body ?? '';
    videoMode.value = chapter?.video_mode ?? 'inherit';
    videoSource.value = videoSourceOf(chapter?.video);
    videoSrc.value = chapter?.video?.src ?? '';
    videoPoster.value = chapter?.video?.poster ?? '';
    videoDuration.value = chapter?.video?.durationText ?? chapter?.video?.duration ?? '';
    videoNote.value = chapter?.video?.note ?? '';
    uploading.value = false;
    fieldErrors.title = undefined;
    fieldErrors.body = undefined;
    fieldErrors.videoSrc = undefined;
    fieldErrors.videoPoster = undefined;
    fieldErrors.videoDuration = undefined;
    fieldErrors.videoNote = undefined;
  },
  { immediate: true },
);

function isSafeLocalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('..') && !value.includes('\\');
}

function validateVideo(): boolean {
  if (videoMode.value !== 'custom') return true;
  const src = videoSrc.value.trim();
  const poster = videoPoster.value.trim();

  if (!src) fieldErrors.videoSrc = '视频 src 不能为空';
  else if (src.length > 500) fieldErrors.videoSrc = '视频地址过长';
  else if (!isSafeLocalPath(src)) fieldErrors.videoSrc = '必须使用站内路径（以 / 开头）';

  if (poster.length > 500) fieldErrors.videoPoster = '封面地址过长';
  else if (poster && !isSafeLocalPath(poster)) {
    fieldErrors.videoPoster = '必须使用站内路径（以 / 开头）';
  }

  if (videoDuration.value.trim().length > 40) fieldErrors.videoDuration = '时长文本过长';
  if (videoNote.value.trim().length > 200) fieldErrors.videoNote = '备注过长';
  return !fieldErrors.videoSrc && !fieldErrors.videoPoster && !fieldErrors.videoDuration && !fieldErrors.videoNote;
}

function customVideoPayload(): CourseVideoInput {
  const payload: CourseVideoInput = { src: videoSrc.value.trim() };
  const poster = videoPoster.value.trim();
  const durationText = videoDuration.value.trim();
  const note = videoNote.value.trim();
  if (poster) payload.poster = poster;
  if (durationText) payload.durationText = durationText;
  if (note) payload.note = note;
  return payload;
}

function submit(): void {
  fieldErrors.title = undefined;
  fieldErrors.body = undefined;
  fieldErrors.videoSrc = undefined;
  fieldErrors.videoPoster = undefined;
  fieldErrors.videoDuration = undefined;
  fieldErrors.videoNote = undefined;

  if (uploading.value) {
    fieldErrors.videoSrc = '视频仍在上传，请等待上传完成。';
    return;
  }

  const nextTitle = title.value.trim();
  const nextBody = body.value.trim();
  if (!nextTitle) fieldErrors.title = '章节标题不能为空';
  else if (nextTitle.length > 160) fieldErrors.title = '章节标题过长';
  if (!nextBody) fieldErrors.body = '章节正文不能为空';
  else if (nextBody.length > 50000) fieldErrors.body = '章节正文过长';

  const videoOk = validateVideo();
  if (fieldErrors.title || fieldErrors.body || !videoOk) return;

  emit('submit', {
    title: nextTitle,
    body: nextBody,
    video_mode: videoMode.value,
    video: videoMode.value === 'custom' ? customVideoPayload() : null,
  });
}
</script>

<template>
  <AppDialog v-model:open="openModel" :title="dialogTitle">
    <form novalidate @submit.prevent="submit">
      <p v-if="!chapter" class="dialog-hint">新增章节将追加为第 {{ nextIdx }} 章。</p>

      <div class="form-grid">
        <AppInput
          v-model="title"
          label="标题"
          required
          :maxlength="160"
          class="span-2"
          :disabled="busy"
          :error="fieldErrors.title"
        />
        <label class="field span-2">
          <span class="field-label">正文 <span class="field-required" aria-hidden="true">*</span></span>
          <textarea
            :id="bodyId"
            v-model="body"
            rows="8"
            :maxlength="50000"
            placeholder="支持多段文本，空行分段。"
            :disabled="busy"
            :aria-invalid="fieldErrors.body ? true : undefined"
            :aria-describedby="fieldErrors.body ? bodyErrorId : undefined"
          />
          <span v-if="fieldErrors.body" :id="bodyErrorId" class="field-error" role="alert">
            {{ fieldErrors.body }}
          </span>
        </label>
      </div>

      <VideoConfigFields
        v-model:mode="videoMode"
        v-model:source="videoSource"
        v-model:src="videoSrc"
        v-model:poster="videoPoster"
        v-model:duration-text="videoDuration"
        v-model:note="videoNote"
        context="chapter"
        :disabled="busy"
        :src-error="fieldErrors.videoSrc"
        :poster-error="fieldErrors.videoPoster"
        :duration-error="fieldErrors.videoDuration"
        :note-error="fieldErrors.videoNote"
        @uploading="uploading = $event"
      />

      <div v-if="serverError" class="form-error" role="alert">{{ serverError }}</div>

      <div class="dialog-foot">
        <AppButton variant="ghost" :disabled="busy" @click="openModel = false">取消</AppButton>
        <AppButton type="submit" :loading="busy" :disabled="uploading">
          {{ uploading ? '视频上传中…' : '保存章节' }}
        </AppButton>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.dialog-hint {
  color: var(--muted);
  font-size: 12.5px;
  margin-bottom: 12px;
}

.span-2 {
  grid-column: 1 / -1;
}
</style>