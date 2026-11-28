<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import type { AdminCourse, VideoMode } from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import VideoConfigFields from './VideoConfigFields.vue';
import { courseVideoMode, type AdminCoursePayload } from './adminCourseApi';

/** Media API paths come from uploads; anything else is a manual local URL. */
function videoSourceOf(video: { src?: string | null } | null | undefined): 'upload' | 'url' {
  return video?.src?.startsWith('/api/v1/media/') ? 'upload' : 'url';
}

const props = defineProps<{
  course: AdminCourse | null;
  nextSort: number;
  busy: boolean;
  serverError: string;
}>();

const emit = defineEmits<{
  submit: [payload: AdminCoursePayload];
  remove: [];
}>();

const form = reactive({
  name: '',
  category: '',
  teacher: '',
  level: '入门',
  badge: '',
  color: '#2F78C4',
  sortOrder: '1',
  intro: '',
  videoMode: 'inherit' as VideoMode,
  videoSource: 'upload' as 'upload' | 'url',
  videoSrc: '',
  videoPoster: '',
  videoDuration: '',
  videoNote: '',
});

const uploading = ref(false);

const fieldErrors = reactive<Record<string, string | undefined>>({});
const introId = useId();
const introErrorId = `${introId}-error`;

const isEdit = computed(() => props.course !== null);

function fillFromCourse(): void {
  const course = props.course;
  if (!course) {
    form.name = '';
    form.category = '';
    form.teacher = '';
    form.level = '入门';
    form.badge = '';
    form.color = '#2F78C4';
    form.sortOrder = String(props.nextSort);
    form.intro = '';
    form.videoMode = 'inherit';
    form.videoSource = 'upload';
    form.videoSrc = '';
    form.videoPoster = '';
    form.videoDuration = '';
    form.videoNote = '';
    uploading.value = false;
    return;
  }

  form.name = course.name;
  form.category = course.category;
  form.teacher = course.teacher;
  form.level = course.level;
  form.badge = course.badge ?? '';
  form.color = /^#[0-9a-f]{6}$/i.test(course.color ?? '') ? (course.color as string) : '#2F78C4';
  form.sortOrder = String(course.sort_order);
  form.intro = course.intro ?? '';
  form.videoMode = courseVideoMode(course);
  form.videoSource = videoSourceOf(course.video);
  form.videoSrc = course.video?.src ?? '';
  form.videoPoster = course.video?.poster ?? '';
  form.videoDuration = course.video?.durationText ?? course.video?.duration ?? '';
  form.videoNote = course.video?.note ?? '';
  uploading.value = false;
}

watch(() => props.course, fillFromCourse, { immediate: true });

function clearErrors(): void {
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
}

function isSafeLocalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('..') && !value.includes('\\');
}

function validate(): boolean {
  clearErrors();

  const name = form.name.trim();
  if (!name) fieldErrors.name = '课程名称不能为空';
  else if (name.length > 80) fieldErrors.name = 'name 过长';
  if (form.category.trim().length > 40) fieldErrors.category = 'category 过长';
  if (form.teacher.trim().length > 40) fieldErrors.teacher = 'teacher 过长';
  if (form.level.trim().length > 40) fieldErrors.level = 'level 过长';
  if (form.badge.trim().length > 8) fieldErrors.badge = 'badge 过长';
  if (form.intro.trim().length > 500) fieldErrors.intro = 'intro 过长';
  if (!/^#[0-9a-f]{6}$/i.test(form.color)) fieldErrors.color = '颜色需为 #RRGGBB';
  if (!Number.isInteger(Number(form.sortOrder))) fieldErrors.sortOrder = '排序必须是整数';

  if (form.videoMode === 'custom') {
    const src = form.videoSrc.trim();
    const poster = form.videoPoster.trim();
    if (!src) fieldErrors.videoSrc = '视频 src 不能为空';
    else if (src.length > 500) fieldErrors.videoSrc = '视频地址过长';
    else if (!isSafeLocalPath(src)) fieldErrors.videoSrc = '必须使用站内路径（以 / 开头）';

    if (poster.length > 500) fieldErrors.videoPoster = '封面地址过长';
    else if (poster && !isSafeLocalPath(poster)) fieldErrors.videoPoster = '必须使用站内路径（以 / 开头）';

    if (form.videoDuration.trim().length > 40) fieldErrors.videoDuration = '时长文本过长';
    if (form.videoNote.trim().length > 200) fieldErrors.videoNote = '备注过长';
  }

  return Object.keys(fieldErrors).length === 0;
}

function buildPayload(): AdminCoursePayload {
  const custom = form.videoMode === 'custom';
  return {
    name: form.name.trim(),
    category: form.category.trim(),
    teacher: form.teacher.trim(),
    level: form.level.trim(),
    badge: form.badge.trim(),
    color: form.color,
    sort_order: Number(form.sortOrder),
    intro: form.intro.trim(),
    video_mode: form.videoMode,
    video: custom ? customVideoPayload() : null,
  };
}

function customVideoPayload(): AdminCoursePayload['video'] {
  const payload: NonNullable<AdminCoursePayload['video']> = { src: form.videoSrc.trim() };
  const poster = form.videoPoster.trim();
  const durationText = form.videoDuration.trim();
  const note = form.videoNote.trim();
  if (poster) payload.poster = poster;
  if (durationText) payload.durationText = durationText;
  if (note) payload.note = note;
  return payload;
}

function submit(): void {
  if (uploading.value) {
    fieldErrors.videoSrc = '视频仍在上传，请等待上传完成。';
    return;
  }
  if (!validate()) return;
  emit('submit', buildPayload());
}

const describedByIntro = computed(() => (fieldErrors.intro ? introErrorId : undefined));
</script>

<template>
  <section class="panel" aria-labelledby="course-form-title">
    <div class="panel-head">
      <div>
        <h2 id="course-form-title">课程信息</h2>
        <p class="panel-sub">
          {{ isEdit ? '修改会立即反映到课程详情、章节页与学习看板。' : '保存后即可添加章节；新课程默认没有知识文档。' }}
        </p>
      </div>
    </div>

    <form class="course-form" novalidate @submit.prevent="submit">
      <div class="form-grid">
        <AppInput
          v-model="form.name"
          label="课程名称"
          required
          :maxlength="80"
          :disabled="busy"
          :error="fieldErrors.name"
        />
        <AppInput
          v-model="form.category"
          label="分类"
          :maxlength="40"
          :disabled="busy"
          :error="fieldErrors.category"
        />
        <AppInput
          v-model="form.teacher"
          label="讲师"
          :maxlength="40"
          :disabled="busy"
          :error="fieldErrors.teacher"
        />
        <AppInput
          v-model="form.level"
          label="难度"
          :maxlength="40"
          :disabled="busy"
          :error="fieldErrors.level"
        />
        <AppInput
          v-model="form.badge"
          label="短标签"
          :maxlength="8"
          hint="2–4 个字的角标，例如「入门」。"
          :disabled="busy"
          :error="fieldErrors.badge"
        />
        <label class="field">
          <span class="field-label">主题色</span>
          <input v-model="form.color" type="color" name="color" :disabled="busy" />
          <span v-if="fieldErrors.color" class="field-error" role="alert">{{ fieldErrors.color }}</span>
        </label>
        <AppInput
          v-model="form.sortOrder"
          label="排序"
          type="number"
          step="1"
          inputmode="numeric"
          :disabled="busy"
          :error="fieldErrors.sortOrder"
        />
        <label class="field span-2">
          <span class="field-label">简介</span>
          <textarea
            :id="introId"
            v-model="form.intro"
            rows="3"
            :maxlength="500"
            :disabled="busy"
            :aria-invalid="fieldErrors.intro ? true : undefined"
            :aria-describedby="describedByIntro"
          />
          <span v-if="fieldErrors.intro" :id="introErrorId" class="field-error" role="alert">
            {{ fieldErrors.intro }}
          </span>
        </label>
      </div>

      <VideoConfigFields
        v-model:mode="form.videoMode"
        v-model:source="form.videoSource"
        v-model:src="form.videoSrc"
        v-model:poster="form.videoPoster"
        v-model:duration-text="form.videoDuration"
        v-model:note="form.videoNote"
        context="course"
        :disabled="busy"
        :src-error="fieldErrors.videoSrc"
        :poster-error="fieldErrors.videoPoster"
        :duration-error="fieldErrors.videoDuration"
        :note-error="fieldErrors.videoNote"
        @uploading="uploading = $event"
      />

      <div v-if="serverError" class="form-error" role="alert">{{ serverError }}</div>
      <div v-else-if="Object.keys(fieldErrors).length > 0" class="form-error" role="alert">
        请修正上面标出的字段后再保存。
      </div>

      <div class="form-actions course-actions">
        <AppButton
          v-if="isEdit"
          variant="ghost"
          class="danger-text"
          :disabled="busy"
          @click="emit('remove')"
        >
          删除课程
        </AppButton>
        <AppButton type="submit" :loading="busy" :disabled="uploading">
          {{ uploading ? '视频上传中…' : isEdit ? '保存修改' : '创建课程' }}
        </AppButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.course-actions {
  justify-content: space-between;
}

input[type='color'] {
  padding: 4px;
  min-height: 38px;
  height: 38px;
  cursor: pointer;
}
</style>