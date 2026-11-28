<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { adminApi } from '@/api/endpoints';
import type { AdminCourse, ChapterRow } from '@/api/types';
import { errorMessage } from '@/api/client';
import AppButton from '@/components/ui/AppButton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import ChapterDialog from '@/components/admin/ChapterDialog.vue';
import ChapterManager from '@/components/admin/ChapterManager.vue';
import CourseForm from '@/components/admin/CourseForm.vue';
import {
  createAdminCourse,
  deleteAdminCourse,
  listAdminCourses,
  updateAdminCourse,
  type AdminCoursePayload,
} from '@/components/admin/adminCourseApi';
import { apiErrorList, conflictRecordCount } from '@/components/admin/apiErrors';
import { useConfirm } from '@/composables/useConfirm';
import { usePageTitle } from '@/composables/usePageTitle';
import { useToastStore } from '@/stores/toast';

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const confirm = useConfirm();

const id = computed(() => String(route.params.id ?? ''));
const isNew = computed(() => id.value === 'new');

const courses = ref<AdminCourse[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const saving = ref(false);
const saveError = ref('');

const chapterOpen = ref(false);
const chapterTarget = ref<ChapterRow | null>(null);
const chapterBusy = ref(false);
const chapterError = ref('');
const busyChapterIdx = ref<number | null>(null);

const course = computed(() => courses.value.find((item) => item.id === id.value) ?? null);
const chapters = computed(() => course.value?.chapterDetails ?? []);
const nextSort = computed(() =>
  Math.max(0, ...courses.value.map((item) => Number(item.sort_order) || 0)) + 1,
);
const nextChapterIdx = computed(() =>
  chapters.value.reduce((max, chapter) => Math.max(max, chapter.idx), 0) + 1,
);

usePageTitle(computed(() => (isNew.value ? '新建课程' : course.value?.name ?? '课程编辑器')));

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    courses.value = (await listAdminCourses()).courses;
  } catch (thrown) {
    error.value = errorMessage(thrown);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(id, () => {
  saveError.value = '';
  chapterOpen.value = false;
  void load();
});

async function saveCourse(payload: AdminCoursePayload): Promise<void> {
  saving.value = true;
  saveError.value = '';
  try {
    if (isNew.value) {
      const result = await createAdminCourse(payload);
      toast.ok('课程已创建，可以继续添加章节');
      await router.push(`/admin/courses/${encodeURIComponent(result.course.id)}`);
    } else if (course.value) {
      await updateAdminCourse(course.value.id, payload);
      toast.ok('课程信息已保存');
      await load();
    }
  } catch (thrown) {
    saveError.value = apiErrorList(thrown).join('；');
  } finally {
    saving.value = false;
  }
}

async function removeCourse(): Promise<void> {
  const current = course.value;
  if (!current) return;

  const first = await confirm({
    title: '删除课程',
    message: `确定删除课程「${current.name}」？`,
    confirmText: '删除',
    danger: true,
  });
  if (!first) return;

  try {
    const result = await deleteAdminCourse(current.id);
    finishDelete(current, result.deletedRecords);
  } catch (thrown) {
    const records = conflictRecordCount(thrown);
    if (records === null) {
      saveError.value = apiErrorList(thrown).join('；');
      return;
    }

    const force = await confirm({
      title: '课程仍有学习记录',
      message:
        `该课程还有 ${records} 条学习记录。\n` +
        '继续删除会同时删除这些学习记录、章节与知识文档，且无法撤销。确定吗？',
      confirmText: '同时删除记录',
      danger: true,
    });
    if (!force) return;

    try {
      const result = await deleteAdminCourse(current.id, true);
      finishDelete(current, result.deletedRecords);
    } catch (secondError) {
      saveError.value = apiErrorList(secondError).join('；');
    }
  }
}

function finishDelete(target: AdminCourse, deletedRecords: number): void {
  toast.ok(
    deletedRecords > 0
      ? `课程「${target.name}」及其 ${deletedRecords} 条学习记录已删除`
      : `课程「${target.name}」已删除`,
  );
  void router.push('/admin');
}

function openAddChapter(): void {
  chapterTarget.value = null;
  chapterError.value = '';
  chapterOpen.value = true;
}

function openEditChapter(chapter: ChapterRow): void {
  chapterTarget.value = chapter;
  chapterError.value = '';
  chapterOpen.value = true;
}

async function submitChapter(payload: { title: string; body: string }): Promise<void> {
  const current = course.value;
  if (!current) return;

  chapterBusy.value = true;
  chapterError.value = '';
  try {
    if (chapterTarget.value) {
      await adminApi.chapters.update(current.id, chapterTarget.value.idx, payload);
      toast.ok('章节已更新');
    } else {
      const result = await adminApi.chapters.create(current.id, payload);
      toast.ok(`章节已新增为第 ${result.chapter.idx} 章`);
    }
    chapterOpen.value = false;
    await load();
  } catch (thrown) {
    chapterError.value = apiErrorList(thrown).join('；');
  } finally {
    chapterBusy.value = false;
  }
}

async function removeChapter(chapter: ChapterRow): Promise<void> {
  const current = course.value;
  if (!current) return;

  const ok = await confirm({
    title: '删除章节',
    message:
      `确定删除第 ${chapter.idx} 章「${chapter.title}」？\n` +
      `删除后编号 ${chapter.idx} 会保留为空缺，后续章节不会重新编号。`,
    confirmText: '删除章节',
    danger: true,
  });
  if (!ok) return;

  busyChapterIdx.value = chapter.idx;
  try {
    await adminApi.chapters.remove(current.id, chapter.idx);
    toast.ok(`章节已删除（第 ${chapter.idx} 章编号保留为空缺）`);
    await load();
  } catch (thrown) {
    toast.error(apiErrorList(thrown).join('；'));
  } finally {
    busyChapterIdx.value = null;
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <nav class="crumbs" aria-label="面包屑">
        <RouterLink to="/admin">管理后台</RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ isNew ? '新建课程' : course?.name ?? '课程编辑器' }}</span>
      </nav>
      <span class="eyebrow">ADMIN · 课程</span>
      <h1>{{ isNew ? '新建课程' : course?.name ?? '课程编辑器' }}</h1>
      <p v-if="isNew">保存后即可添加章节；新课程默认没有知识文档。</p>
      <p v-else-if="course">修改会立即反映到课程详情、章节页与学习看板；重命名不会改写历史学习记录。</p>
    </div>
    <div class="page-actions">
      <AppButton variant="ghost" size="sm" to="/admin">← 返回列表</AppButton>
      <AppButton
        v-if="!isNew && course"
        variant="ghost"
        size="sm"
        :to="`/courses/${encodeURIComponent(course.id)}`"
      >
        查看课程页
      </AppButton>
    </div>
  </header>

  <LoadingBlock v-if="loading" text="正在加载课程…" />
  <ErrorCard v-else-if="error" :message="error" @retry="load" />
  <EmptyState
    v-else-if="!isNew && !course"
    title="课程不存在"
    message="该课程可能已被删除，或链接有误。"
  >
    <AppButton to="/admin">返回管理后台</AppButton>
  </EmptyState>

  <template v-else>
    <CourseForm
      :course="course"
      :next-sort="nextSort"
      :busy="saving"
      :server-error="saveError"
      @submit="saveCourse"
      @remove="removeCourse"
    />

    <ChapterManager
      v-if="!isNew && course"
      :chapters="chapters"
      :busy-idx="busyChapterIdx"
      @add="openAddChapter"
      @edit="openEditChapter"
      @remove="removeChapter"
    />

    <p v-if="isNew" class="footnote">
      创建课程后才能管理章节。课程保存在模拟数据库中，所有管理操作都会写入审计日志。
    </p>

    <ChapterDialog
      v-if="course"
      v-model:open="chapterOpen"
      :chapter="chapterTarget"
      :next-idx="nextChapterIdx"
      :busy="chapterBusy"
      :server-error="chapterError"
      @submit="submitChapter"
    />
  </template>
</template>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--muted);
  margin-bottom: 8px;
}

.crumbs a {
  color: var(--blue);
  font-weight: 600;
}
</style>