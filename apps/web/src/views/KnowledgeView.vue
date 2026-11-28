<script setup lang="ts">
/**
 * Knowledge center (F072).
 *
 * Loads the course catalogue (for the tab strip) and `GET /knowledge/:id`
 * (default C1). Courses without a knowledge document get an empty state.
 */
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { catalogApi } from '@/api/endpoints';
import type { CoursesResponse, KnowledgeResponse } from '@/api/types';
import { useAsyncData, useAsyncState } from '@/composables/useAsyncState';
import { useAuthStore } from '@/stores/auth';
import AppButton from '@/components/ui/AppButton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import KnowledgeBody from '@/components/knowledge/KnowledgeBody.vue';
import KnowledgeCourseTabs from '@/components/knowledge/KnowledgeCourseTabs.vue';

const route = useRoute();
const auth = useAuthStore();

const { data: catalog } = useAsyncData<CoursesResponse>(() => catalogApi.courses(), {
  immediate: true,
});

const {
  data: doc,
  loading: docLoading,
  error: docError,
  run: loadDoc,
  reset: clearDoc,
} = useAsyncState<KnowledgeResponse>();

const courseId = computed(() => {
  const raw = route.params.id;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value ? value : 'C1';
});

function reloadDoc(): void {
  void loadDoc(() => catalogApi.knowledge(courseId.value));
}

watch(
  courseId,
  (id) => {
    clearDoc();
    void loadDoc(() => catalogApi.knowledge(id));
  },
  { immediate: true },
);

const course = computed(() => doc.value?.course ?? null);
const knowledge = computed(() => doc.value?.knowledge ?? null);

const courseTabs = computed(
  () => catalog.value?.courses.map((entry) => ({ id: entry.id, name: entry.name })) ?? [],
);

const catalogCourseName = computed(
  () => catalog.value?.courses.find((entry) => entry.id === courseId.value)?.name,
);

const pageTitle = computed(
  () => knowledge.value?.title ?? course.value?.name ?? catalogCourseName.value ?? '知识中心',
);

const pageSub = computed(() => {
  if (docLoading.value) return '正在加载课程知识内容…';
  if (docError.value) return '课程知识内容加载失败。';
  if (!knowledge.value) {
    return course.value ? '该课程暂时没有知识文档。' : '课程摘要、知识点、术语与测验。';
  }
  return `原始资料：${knowledge.value.source}。摘要、知识点、术语、FAQ 与测验均来自原文，未加入原文之外的事实。`;
});
</script>

<template>
  <header class="page-head knowledge-head">
    <div>
      <span class="eyebrow">知识中心 · 依据讲义原文提炼</span>
      <h1>{{ pageTitle }}</h1>
      <p>{{ pageSub }}</p>
    </div>
    <KnowledgeCourseTabs v-if="courseTabs.length" :courses="courseTabs" />
  </header>

  <div v-if="docLoading && !doc">
    <LoadingBlock text="正在加载知识文档…" />
  </div>

  <ErrorCard
    v-else-if="docError && !doc"
    title="知识文档加载失败"
    :message="docError"
    @retry="reloadDoc"
  />

  <template v-else-if="doc">
    <KnowledgeBody
      v-if="course && knowledge"
      :key="course.id"
      :course="course"
      :knowledge="knowledge"
    />

    <section v-else class="panel">
      <EmptyState
        title="暂无知识文档"
        message="后台新建的课程默认没有知识文档。可以先查看课程详情与章节，或补充知识内容后再启用知识中心。"
      >
        <div class="form-actions empty-actions">
          <AppButton v-if="course" variant="primary" :to="`/courses/${course.id}`">
            查看课程详情
          </AppButton>
          <AppButton v-if="auth.isAdmin" variant="ghost" to="/admin">管理后台</AppButton>
        </div>
      </EmptyState>
    </section>
  </template>
</template>

<style scoped>
.knowledge-head {
  margin-bottom: 18px;
}

.knowledge-head h1 {
  font-size: clamp(24px, 3vw, 34px);
}

.knowledge-head > :last-child {
  max-width: 100%;
}

.empty-actions {
  justify-content: center;
}
</style>
