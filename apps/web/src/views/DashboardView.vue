<script setup lang="ts">
/**
 * Learning dashboard (F073).
 *
 * Every number comes from `GET /dashboard?course=`; the course filter is kept
 * in the URL query so refreshes and deep links preserve the selection. Admins
 * also get the record playground (F083), which re-runs the dashboard and
 * `/meta` when it reports a change.
 */
import { computed, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { analyticsApi, catalogApi } from '@/api/endpoints';
import type { DashboardResponse } from '@/api/types';
import { useAsyncState } from '@/composables/useAsyncState';
import { useCompact } from '@/composables/useCompact';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';
import { dec1, num } from '@/utils/format';
import AppButton from '@/components/ui/AppButton.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import DatasetLine from '@/components/dashboard/DatasetLine.vue';
import DashboardCharts from '@/components/dashboard/DashboardCharts.vue';
import InsightCard from '@/components/dashboard/InsightCard.vue';
import KpiCard from '@/components/dashboard/KpiCard.vue';
import RecordPlayground from '@/components/dashboard/RecordPlayground.vue';

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const auth = useAuthStore();
const compact = useCompact();

const { data, loading, error, run } = useAsyncState<DashboardResponse>();

/** Exact course name from the query string (`''` = all courses). */
const filter = computed(() => {
  const value = route.query.course;
  return typeof value === 'string' ? value : '';
});

let cleaningQuery = false;

async function load(): Promise<void> {
  const requested = filter.value;
  const response = await run(() => analyticsApi.dashboard(requested || undefined));
  if (requested && response && !response.courseOptions.includes(requested)) {
    // Renamed/deleted course: the API already served the full site. Drop the
    // stale query so the select and the URL agree.
    cleaningQuery = true;
    await router.replace({ query: { ...route.query, course: undefined } });
  }
}

watch(
  filter,
  () => {
    if (cleaningQuery) {
      cleaningQuery = false;
      return;
    }
    void load();
  },
  { immediate: true },
);

function onFilterChange(event: Event): void {
  const next = (event.target as HTMLSelectElement).value;
  void router.replace({
    query: next ? { ...route.query, course: next } : { ...route.query, course: undefined },
  });
}

async function refreshNow(): Promise<void> {
  await load();
  toast.ok('指标已刷新');
}

async function onRecordsChanged(): Promise<void> {
  await load();
  // Keep the footer/dataset provenance in sync after a record edit/reset.
  await Promise.all([catalogApi.meta().catch(() => null)]);
}

const overview = computed(() => data.value?.overview ?? null);

const kpiCards = computed(() => {
  const o = overview.value;
  if (!o) return [];
  return [
    {
      label: '学生人数',
      display: num(o.students),
      unit: '人',
      hint: `按 student_id 去重 · ${num(o.records)} 条记录`,
      color: '#2F78C4',
    },
    {
      label: '选课数',
      display: num(o.enrollments),
      unit: '条',
      hint: '学生 × 课程唯一组合',
      color: '#06C7CC',
    },
    {
      label: '平均完成率',
      display: dec1(o.avgCompletion),
      unit: '%',
      hint: '每条选课最大进度求平均',
      color: '#E8833A',
    },
    {
      label: '平均测验成绩',
      display: dec1(o.avgScore),
      unit: '分',
      hint: `有成绩 ${num(o.scoredEnrollments)} 条 · 无成绩 ${num(o.noScoreEnrollments)} 条`,
      color: '#6C5CE7',
    },
    {
      label: '累计学习时长',
      display: dec1(o.totalHours),
      unit: '小时',
      hint: `${num(o.totalMinutes)} 分钟 ÷ 60`,
      color: '#1E9E6A',
    },
  ];
});

const insightPreview = computed(() => data.value?.insights.slice(0, 2) ?? []);

const playgroundCourses = computed(
  () => data.value?.courseCatalog.map((course) => course.name) ?? [],
);

const filterLabel = computed(() => (filter.value ? `范围：${filter.value}` : '全站数据'));
</script>

<template>
  <header class="page-head">
    <div>
      <span class="eyebrow">学习看板 · 数据实时计算</span>
      <h1>学习数据总览</h1>
      <p>
        指标来自数据库中的原始学习记录，不使用任何写死的数字。默认口径：一条选课 = 一个学生 ×
        一门课程。
      </p>
    </div>

    <div v-if="data" class="dash-controls">
      <label for="dashFilter">课程筛选</label>
      <select id="dashFilter" :value="filter" :disabled="loading" @change="onFilterChange">
        <option value="">全部课程</option>
        <option v-for="name in data.courseOptions" :key="name" :value="name">{{ name }}</option>
      </select>
      <AppButton variant="ghost" size="sm" :loading="loading" @click="refreshNow">刷新</AppButton>
    </div>
  </header>

  <div v-if="!data && loading">
    <LoadingBlock text="正在计算指标…" />
  </div>

  <ErrorCard v-else-if="!data && error" title="看板加载失败" :message="error" @retry="load" />

  <template v-else-if="data && overview">
    <DatasetLine
      :dataset="data.dataset"
      :filter="data.filter"
      :course-count="overview.courses"
      :record-count="overview.records"
    />

    <section class="kpi-grid" aria-label="核心指标">
      <KpiCard
        v-for="card in kpiCards"
        :key="card.label"
        :label="card.label"
        :display="card.display"
        :unit="card.unit"
        :hint="card.hint"
        :color="card.color"
      />
    </section>

    <DashboardCharts :data="data" :compact="compact" />

    <section
      v-if="insightPreview.length"
      class="panel insight-preview"
      aria-labelledby="dashInsightTitle"
    >
      <div class="panel-head">
        <div>
          <h2 id="dashInsightTitle">数据洞察</h2>
          <p class="panel-sub">由当前数据自动生成，{{ filterLabel }}。</p>
        </div>
        <AppButton variant="ghost" size="sm" to="/insights">全部洞察 →</AppButton>
      </div>
      <div class="insight-grid">
        <InsightCard
          v-for="insight in insightPreview"
          :key="insight.id"
          :insight="insight"
          :show-action="false"
        />
      </div>
    </section>

    <RecordPlayground
      v-if="auth.isAdmin"
      :course-options="playgroundCourses"
      @changed="onRecordsChanged"
    />

    <p v-else class="footnote">
      数据演示面板仅对管理员开放。
      <RouterLink to="/login">登录管理员账号</RouterLink>
      后可编辑学习记录、导入 CSV 或恢复初始数据。
    </p>
  </template>
</template>

<style scoped>
.dash-controls {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 9px 12px;
  box-shadow: var(--shadow);
}

.dash-controls label {
  font-size: 12.5px;
  color: var(--muted);
  font-weight: 600;
}

.dash-controls select {
  width: auto;
  min-width: 180px;
}

@media (max-width: 480px) {
  .dash-controls {
    width: 100%;
  }

  .dash-controls select {
    flex: 1;
    min-width: 0;
  }
}
</style>
