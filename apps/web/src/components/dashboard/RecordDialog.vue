<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import { recordsApi } from '@/api/endpoints';
import type { RecordInput, RecordRow } from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';
import AppDialog from '@/components/ui/AppDialog.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { useToastStore } from '@/stores/toast';
import { recordErrorList } from './recordErrors';

const props = defineProps<{
  open: boolean;
  /** Existing record to edit, or null for a new record. */
  record: RecordRow | null;
  courseOptions: string[];
}>();

const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [] }>();

const toast = useToastStore();
const busy = ref(false);
const serverErrors = ref<string[]>([]);
const fieldErrors = reactive<Record<string, string | undefined>>({});
const formErrorId = useId();

const form = reactive({
  student_id: '',
  course_name: '',
  learning_date: '',
  learning_minutes: '45',
  chapters_done: '1',
  total_chapters: '5',
  quiz_score: '',
});

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const title = computed(() =>
  props.record ? `编辑记录 #${props.record.id}` : '新增学习记录',
);

const courseChoices = computed(() => {
  const names = new Set(props.courseOptions);
  if (props.record?.course_name) names.add(props.record.course_name);
  if (form.course_name) names.add(form.course_name);
  return [...names];
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetForm(): void {
  const record = props.record;
  form.student_id = record?.student_id ?? '';
  form.course_name = record?.course_name ?? props.courseOptions[0] ?? '';
  form.learning_date = record?.learning_date ?? today();
  form.learning_minutes = String(record?.learning_minutes ?? 45);
  form.chapters_done = String(record?.chapters_done ?? 1);
  form.total_chapters = String(record?.total_chapters ?? 5);
  form.quiz_score = record?.quiz_score === null || record?.quiz_score === undefined
    ? ''
    : String(record.quiz_score);
  serverErrors.value = [];
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
}

watch(
  () => [props.open, props.record] as const,
  ([open]) => {
    if (open) resetForm();
  },
  { immediate: true },
);

function integer(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function validate(): boolean {
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];

  const student = form.student_id.trim();
  if (!student) fieldErrors.student_id = 'student_id 不能为空';
  else if (student.length > 32) fieldErrors.student_id = 'student_id 过长';

  if (!form.course_name) fieldErrors.course_name = '请选择课程';
  if (!form.learning_date) fieldErrors.learning_date = '请选择学习日期';

  const minutes = integer(form.learning_minutes);
  if (minutes === null || minutes < 0 || minutes > 1440) {
    fieldErrors.learning_minutes = '需为 0–1440 的整数';
  }

  const done = integer(form.chapters_done);
  if (done === null || done < 0) fieldErrors.chapters_done = '需为非负整数';

  const total = integer(form.total_chapters);
  if (total === null || total < 1) fieldErrors.total_chapters = '需为正整数';
  else if (done !== null && done > total) fieldErrors.chapters_done = '已完成章节不能大于总章节数';

  const quiz = form.quiz_score.trim();
  if (quiz !== '') {
    const parsed = Number(quiz);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      fieldErrors.quiz_score = '需为 0–100 或留空';
    }
  }

  return Object.keys(fieldErrors).length === 0;
}

async function submit(): Promise<void> {
  serverErrors.value = [];
  if (!validate()) return;

  const quizText = form.quiz_score.trim();
  const payload: RecordInput = {
    student_id: form.student_id.trim(),
    course_name: form.course_name,
    learning_date: form.learning_date,
    learning_minutes: Number(form.learning_minutes),
    chapters_done: Number(form.chapters_done),
    total_chapters: Number(form.total_chapters),
    quiz_score: quizText === '' ? null : Number(quizText),
  };

  busy.value = true;
  try {
    if (props.record) {
      await recordsApi.update(props.record.id, payload);
      toast.ok('记录已更新，指标已重新计算');
    } else {
      await recordsApi.create(payload);
      toast.ok('记录已新增，指标已重新计算');
    }
    emit('saved');
    openModel.value = false;
  } catch (error) {
    serverErrors.value = recordErrorList(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog v-model:open="openModel" :title="title">
    <form novalidate @submit.prevent="submit">
      <div class="form-grid">
        <AppInput
          v-model="form.student_id"
          label="学生编号"
          required
          :maxlength="32"
          placeholder="S001"
          autocomplete="off"
          :disabled="busy"
          :error="fieldErrors.student_id"
        />
        <label class="field">
          <span class="field-label">课程 <span class="field-required" aria-hidden="true">*</span></span>
          <select v-model="form.course_name" name="course_name" :disabled="busy">
            <option value="" disabled>请选择课程</option>
            <option v-for="name in courseChoices" :key="name" :value="name">{{ name }}</option>
          </select>
          <span v-if="fieldErrors.course_name" class="field-error" role="alert">
            {{ fieldErrors.course_name }}
          </span>
        </label>
        <AppInput
          v-model="form.learning_date"
          label="学习日期"
          type="date"
          required
          :disabled="busy"
          :error="fieldErrors.learning_date"
        />
        <AppInput
          v-model="form.learning_minutes"
          label="学习时长（分钟）"
          type="number"
          min="0"
          max="1440"
          step="1"
          inputmode="numeric"
          :disabled="busy"
          :error="fieldErrors.learning_minutes"
        />
        <AppInput
          v-model="form.chapters_done"
          label="已完成章节"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          :disabled="busy"
          :error="fieldErrors.chapters_done"
        />
        <AppInput
          v-model="form.total_chapters"
          label="总章节数"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          :disabled="busy"
          :error="fieldErrors.total_chapters"
        />
        <AppInput
          v-model="form.quiz_score"
          label="测验成绩（可留空）"
          type="number"
          min="0"
          max="100"
          step="0.1"
          placeholder="留空表示未参加测验"
          class="span-2"
          :disabled="busy"
          :error="fieldErrors.quiz_score"
        />
      </div>

      <div v-if="serverErrors.length > 0" :id="formErrorId" class="form-error" role="alert">
        <ul class="error-list">
          <li v-for="message in serverErrors" :key="message">{{ message }}</li>
        </ul>
      </div>

      <div class="dialog-foot">
        <AppButton variant="ghost" :disabled="busy" @click="openModel = false">取消</AppButton>
        <AppButton type="submit" :loading="busy">保存并重算</AppButton>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.error-list {
  margin: 0;
  padding-left: 18px;
}

.span-2 {
  grid-column: 1 / -1;
}
</style>