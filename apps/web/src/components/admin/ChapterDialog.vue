<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import type { ChapterRow } from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';
import AppDialog from '@/components/ui/AppDialog.vue';
import AppInput from '@/components/ui/AppInput.vue';

const props = defineProps<{
  open: boolean;
  /** Chapter being edited, or null when appending a new chapter. */
  chapter: ChapterRow | null;
  /** Index the next appended chapter will receive (add mode hint). */
  nextIdx: number;
  busy: boolean;
  serverError: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  submit: [payload: { title: string; body: string }];
}>();

const title = ref('');
const body = ref('');
const fieldErrors = reactive<{ title?: string; body?: string }>({});
const bodyId = useId();
const bodyErrorId = `${bodyId}-error`;

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const dialogTitle = computed(() =>
  props.chapter ? `编辑第 ${props.chapter.idx} 章` : '新增章节',
);

watch(
  () => [props.open, props.chapter] as const,
  ([open]) => {
    if (!open) return;
    title.value = props.chapter?.title ?? '';
    body.value = props.chapter?.body ?? '';
    fieldErrors.title = undefined;
    fieldErrors.body = undefined;
  },
  { immediate: true },
);

function submit(): void {
  fieldErrors.title = undefined;
  fieldErrors.body = undefined;

  const nextTitle = title.value.trim();
  const nextBody = body.value.trim();
  if (!nextTitle) fieldErrors.title = '章节标题不能为空';
  else if (nextTitle.length > 160) fieldErrors.title = '章节标题过长';
  if (!nextBody) fieldErrors.body = '章节正文不能为空';
  else if (nextBody.length > 50000) fieldErrors.body = '章节正文过长';

  if (fieldErrors.title || fieldErrors.body) return;
  emit('submit', { title: nextTitle, body: nextBody });
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
            rows="11"
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

      <div v-if="serverError" class="form-error" role="alert">{{ serverError }}</div>

      <div class="dialog-foot">
        <AppButton variant="ghost" :disabled="busy" @click="openModel = false">取消</AppButton>
        <AppButton type="submit" :loading="busy">保存章节</AppButton>
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