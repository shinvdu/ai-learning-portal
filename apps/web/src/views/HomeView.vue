<script setup lang="ts">
/**
 * F071 · 课程广场.
 *
 * Hero KPIs come from `GET /meta` (`overview`); cards come from `GET /courses`
 * (per-course stats + categories). Filtering/sorting happen client-side on the
 * fetched list, exactly like v1. No number is hardcoded.
 */
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { errorMessage } from '@/api/client';
import { catalogApi } from '@/api/endpoints';
import type { CoursesResponse, MetaResponse } from '@/api/types';
import CourseCard from '@/components/course/CourseCard.vue';
import AppButton from '@/components/ui/AppButton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import { dec1, num, pct } from '@/utils/format';

type SortKey = 'default' | 'learners' | 'completion' | 'score';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'default', label: '默认顺序' },
  { value: 'learners', label: '学习人数从多到少' },
  { value: 'completion', label: '完成率从高到低' },
  { value: 'score', label: '平均成绩从高到低' },
];

const loading = ref(true);
const error = ref<string | null>(null);
const meta = ref<MetaResponse | null>(null);
const catalog = ref<CoursesResponse | null>(null);

const query = ref('');
const category = ref('全部');
const sort = ref<SortKey>('default');

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [metaData, courseData] = await Promise.all([catalogApi.meta(), catalogApi.courses()]);
    meta.value = metaData;
    catalog.value = courseData;
  } catch (thrown) {
    meta.value = null;
    catalog.value = null;
    error.value = errorMessage(thrown, '课程数据加载失败');
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

const overview = computed(() => meta.value?.overview ?? null);
const courses = computed(() => catalog.value?.courses ?? []);
const categories = computed(() => ['全部', ...(catalog.value?.categories ?? [])]);

const visibleCourses = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  let list = courses.value.filter((course) => {
    const categoryOk = category.value === '全部' || course.category === category.value;
    const keywordOk =
      !keyword ||
      [course.name, course.intro ?? '', course.teacher, course.category].some((value) =>
        String(value).toLowerCase().includes(keyword),
      );
    return categoryOk && keywordOk;
  });

  if (sort.value === 'learners') {
    list = [...list].sort((a, b) => (b.stats?.learners ?? 0) - (a.stats?.learners ?? 0));
  } else if (sort.value === 'completion') {
    list = [...list].sort((a, b) => (b.stats?.completion ?? 0) - (a.stats?.completion ?? 0));
  } else if (sort.value === 'score') {
    list = [...list].sort((a, b) => (b.stats?.avgScore ?? 0) - (a.stats?.avgScore ?? 0));
  }

  return list;
});

function resetFilters(): void {
  query.value = '';
  category.value = '全部';
  sort.value = 'default';
}
</script>

<template>
  <LoadingBlock v-if="loading" text="正在加载课程数据…" />

  <ErrorCard v-else-if="error" :message="error" @retry="load" />

  <template v-else-if="meta && catalog">
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">AI LEARNING PORTAL · 课程广场</span>
        <h1>AI 学习与<br />数据分析门户</h1>
        <p>
          课程、知识中心与学习看板的一站式演示。<br />
          所有指标由 API 实时计算——改一条数据，数字立即变化。
        </p>
        <div class="hero-actions">
          <RouterLink class="btn btn-light" to="/dashboard">查看学习看板</RouterLink>
          <RouterLink class="btn btn-outline-light" to="/knowledge">浏览知识中心</RouterLink>
        </div>
      </div>

      <div class="hero-stats" aria-label="数据概览">
        <div class="hero-stat">
          <span>学生人数</span>
          <strong>{{ num(overview?.students) }}</strong>
          <small>按 student_id 去重</small>
        </div>
        <div class="hero-stat">
          <span>课程数量</span>
          <strong>{{ num(overview?.courses) }}</strong>
          <small>演示数据集</small>
        </div>
        <div class="hero-stat">
          <span>选课记录</span>
          <strong>{{ num(overview?.enrollments) }}</strong>
          <small>学生 × 课程</small>
        </div>
        <div class="hero-stat">
          <span>平均完成率</span>
          <strong>{{ pct(overview?.avgCompletion) }}</strong>
          <small>按选课取最大进度</small>
        </div>
        <div class="hero-stat">
          <span>平均测验成绩</span>
          <strong>{{ dec1(overview?.avgScore) }}</strong>
          <small>有成绩 {{ num(overview?.scoredEnrollments) }} 条 · 无成绩 {{ num(overview?.noScoreEnrollments) }} 条</small>
        </div>
        <div class="hero-stat">
          <span>累计学习</span>
          <strong>{{ dec1(overview?.totalHours) }}<i>h</i></strong>
          <small>{{ num(overview?.totalMinutes) }} 分钟</small>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="coursesTitle">
      <div class="section-head">
        <div>
          <h2 id="coursesTitle">课程广场</h2>
          <p>
            {{ courses.length }} 门课程覆盖 AI 基础、提示词、数据分析、前端开发与安全使用。课程学习数据来自同一份模拟
            CSV。
          </p>
        </div>
        <RouterLink class="btn btn-ghost btn-sm" to="/insights">查看数据洞察 →</RouterLink>
      </div>

      <div class="toolbar" role="search">
        <div class="chips" role="group" aria-label="按分类筛选">
          <button
            v-for="cat in categories"
            :key="cat"
            type="button"
            class="chip"
            :class="{ active: category === cat }"
            :aria-pressed="category === cat"
            @click="category = cat"
          >
            {{ cat }}
          </button>
        </div>

        <label class="sr-only" for="course-search">搜索课程、讲师或关键词</label>
        <input
          id="course-search"
          v-model="query"
          type="search"
          placeholder="搜索课程、讲师或关键词"
          autocomplete="off"
        />

        <label class="sr-only" for="course-sort">排序方式</label>
        <select id="course-sort" v-model="sort">
          <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>

      <div v-if="visibleCourses.length > 0" class="grid">
        <CourseCard
          v-for="course in visibleCourses"
          :key="course.id"
          :course="course"
        />
      </div>

      <EmptyState v-else title="没有匹配的课程" message="试试更换分类，或换一个搜索关键词。">
        <AppButton variant="ghost" size="sm" @click="resetFilters">清除筛选</AppButton>
      </EmptyState>

      <p class="result-count" role="status">
        显示 {{ visibleCourses.length }} / {{ courses.length }} 门课程 · 点击卡片进入课程详情
      </p>
    </section>
  </template>

  <EmptyState v-else title="暂无课程" message="课程数据暂时为空，请稍后重试。" />
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.85fr);
  gap: 34px;
  align-items: center;
  padding: 42px 40px;
  border-radius: var(--radius-lg);
  color: #fff;
  background:
    radial-gradient(680px 340px at 92% -10%, rgba(6, 199, 204, 0.34), transparent 62%),
    radial-gradient(520px 320px at 8% 110%, rgba(108, 92, 231, 0.28), transparent 60%),
    linear-gradient(118deg, #000048 0%, #10236f 52%, #2358a8 100%);
  box-shadow: var(--shadow-lg);
}

.hero::after {
  content: '';
  position: absolute;
  right: 28px;
  top: 22px;
  width: 180px;
  height: 180px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 44px;
  transform: rotate(18deg);
  pointer-events: none;
}

.hero .eyebrow {
  color: #8cf3f5;
}

.hero h1 {
  color: #fff;
  font-size: clamp(28px, 3.6vw, 44px);
  letter-spacing: -0.6px;
  max-width: 720px;
}

.hero-copy p {
  color: #d7dcff;
  font-size: 15px;
  max-width: 620px;
  margin-top: 12px;
}

.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 22px;
}

.btn-outline-light {
  background: transparent;
  color: #fff;
  border-color: rgba(255, 255, 255, 0.45);
}

.btn-outline-light:hover {
  background: rgba(255, 255, 255, 0.12);
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  position: relative;
  z-index: 1;
}

.hero-stat {
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  padding: 14px 16px;
  backdrop-filter: blur(4px);
}

.hero-stat:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.hero-stat span {
  display: block;
  font-size: 12px;
  color: #b9c4ff;
  letter-spacing: 0.3px;
}

.hero-stat strong {
  display: block;
  font-size: 30px;
  line-height: 1.2;
  color: #fff;
  font-weight: 800;
  letter-spacing: -0.5px;
}

.hero-stat strong i {
  font-style: normal;
  font-size: 15px;
  margin-left: 2px;
  color: #8cf3f5;
}

.hero-stat small {
  display: block;
  font-size: 11px;
  color: #a9b5f2;
  margin-top: 2px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.toolbar input[type='search'] {
  flex: 1 1 220px;
  max-width: 340px;
}

.toolbar select {
  width: auto;
  min-width: 168px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(285px, 1fr));
  gap: 18px;
}

.result-count {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--muted);
}

@media (max-width: 940px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 32px 26px;
  }

  .toolbar input[type='search'],
  .toolbar select {
    max-width: none;
    flex: 1 1 100%;
    width: 100%;
  }
}

@media (max-width: 720px) {
  .hero {
    padding: 26px 18px;
  }

  .hero-stats {
    gap: 9px;
  }

  .hero-stat strong {
    font-size: 26px;
  }
}

@media (max-width: 480px) {
  .hero h1 {
    font-size: 26px;
  }

  .hero-stat {
    padding: 11px 13px;
  }

  .grid {
    grid-template-columns: 1fr;
  }
}
</style>