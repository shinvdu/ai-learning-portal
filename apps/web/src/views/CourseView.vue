<script setup lang="ts">
/**
 * F071 · 课程详情.
 *
 * `GET /courses/:idOrName` → course metadata, site-consistent stats and the
 * inferred per-chapter reach table. Every displayed number comes from that
 * response; the component only formats it.
 */
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ApiError, errorMessage } from '@/api/client';
import { catalogApi } from '@/api/endpoints';
import type { ChapterStat, CourseDetailResponse } from '@/api/types';
import VideoPlayer from '@/components/course/VideoPlayer.vue';
import { courseBadge, courseColor, completionOf, videoDuration } from '@/components/course/course';
import AppButton from '@/components/ui/AppButton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import MeterBar from '@/components/ui/MeterBar.vue';
import { dec1, num, pct } from '@/utils/format';

const route = useRoute();

const data = ref<CourseDetailResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const status = ref<number | null>(null);
let requestId = 0;

async function load(): Promise<void> {
  const id = String(route.params.id ?? '');
  const current = ++requestId;
  loading.value = true;
  error.value = null;
  status.value = null;
  try {
    const result = await catalogApi.course(id);
    if (current !== requestId) return;
    data.value = result;
  } catch (thrown) {
    if (current !== requestId) return;
    data.value = null;
    status.value = thrown instanceof ApiError ? thrown.status : 0;
    error.value = errorMessage(thrown, '课程加载失败');
  } finally {
    if (current === requestId) loading.value = false;
  }
}

watch(
  () => route.params.id,
  () => void load(),
  { immediate: true },
);

const course = computed(() => data.value?.course ?? null);
const stats = computed(() => data.value?.stats ?? null);
const accent = computed(() => courseColor(course.value));
const notFound = computed(() => status.value === 404);

const courseLink = computed(() => `/courses/${encodeURIComponent(course.value?.id ?? '')}`);
const knowledgeLink = computed(() => `/knowledge/${encodeURIComponent(course.value?.id ?? '')}`);
const dashboardTo = computed(() => ({
  path: '/dashboard',
  query: course.value ? { course: course.value.name } : {},
}));

const chapterRows = computed<ChapterStat[]>(() => {
  const fromApi = data.value?.chapterStats ?? [];
  if (fromApi.length > 0) return fromApi;
  const current = course.value;
  if (!current) return [];
  return current.chapters.map((title, index) => ({
    idx: index + 1,
    title,
    total: 0,
    reached: 0,
    notReached: 0,
    reachRate: null,
    avgScoreReached: null,
    avgScoreNotReached: null,
    scoredReached: 0,
    scoredNotReached: 0,
  }));
});

const videoLabel = computed(() =>
  course.value ? `${course.value.name} 课程导览视频` : '课程导览视频',
);
</script>

<template>
  <LoadingBlock v-if="loading" text="正在加载课程详情…" />

  <EmptyState
    v-else-if="notFound"
    title="课程不存在"
    :message="error ?? '该课程可能已被删除，或链接有误。'"
  >
    <AppButton variant="ghost" size="sm" to="/">返回课程广场</AppButton>
  </EmptyState>

  <ErrorCard v-else-if="error" title="课程加载失败" :message="error" @retry="load" />

  <template v-else-if="course">
    <nav class="crumbs" aria-label="面包屑">
      <RouterLink to="/">课程广场</RouterLink>
      <span aria-hidden="true">/</span>
      <span>{{ course.name }}</span>
    </nav>

    <header class="detail-hero" :style="{ '--accent': accent }">
      <span class="detail-badge" :style="{ background: accent }" aria-hidden="true">
        {{ courseBadge(course) }}
      </span>

      <div class="detail-copy">
        <div class="tag-row">
          <span class="tag">{{ course.category }}</span>
          <span class="tag tag-plain">{{ course.level }}</span>
        </div>
        <h1>{{ course.name }}</h1>
        <p>{{ course.intro }}</p>
        <div class="meta-row">
          <span>讲师：{{ course.teacher }}</span>
          <span>{{ course.chapters.length }} 个章节</span>
          <span>{{ num(stats?.learners) }} 人正在学习</span>
          <span v-if="course.video">含 {{ videoDuration(course.video) }} 导览视频</span>
        </div>
      </div>

      <div class="detail-actions">
        <RouterLink class="btn btn-primary" :to="knowledgeLink">进入知识中心</RouterLink>
        <RouterLink class="btn btn-ghost" :to="dashboardTo">查看看板</RouterLink>
      </div>
    </header>

    <section class="stat-row" aria-label="课程数据概览">
      <article class="mini-stat">
        <span>学习人数</span>
        <strong>{{ num(stats?.learners) }}</strong>
        <small>按学生编号去重</small>
      </article>
      <article class="mini-stat">
        <span>学习记录</span>
        <strong>{{ num(stats?.records) }}</strong>
        <small>原始 CSV 行数</small>
      </article>
      <article class="mini-stat">
        <span>平均完成率</span>
        <strong>{{ pct(stats?.completion) }}</strong>
        <small>每条选课最大进度</small>
      </article>
      <article class="mini-stat">
        <span>平均测验成绩</span>
        <strong>{{ dec1(stats?.avgScore) }}</strong>
        <small>有成绩 {{ num(stats?.scoredEnrollments) }} 条 · 无成绩 {{ num(stats?.noScoreEnrollments) }} 条</small>
      </article>
    </section>

    <section v-if="course.video" class="video-panel" aria-labelledby="courseVideoTitle">
      <div class="video-copy">
        <span class="eyebrow">课程导览视频</span>
        <h2 id="courseVideoTitle">
          先看一段 {{ videoDuration(course.video) }} 的课程导览
        </h2>
        <p>{{ course.video.note }}</p>
        <div class="video-meta">
          <span class="tag tag-video">占位视频</span>
          <span>时长 {{ videoDuration(course.video) }}</span>
          <span>无音频</span>
          <span>可按课程替换</span>
        </div>
      </div>
      <VideoPlayer :video="course.video" :label="videoLabel" />
    </section>

    <div class="detail-grid">
      <section class="panel" aria-labelledby="chaptersTitle" :style="{ '--accent': accent }">
        <div class="panel-head">
          <div>
            <h2 id="chaptersTitle">章节目录</h2>
            <p class="panel-sub">
              章节正文来自讲义或后台编辑；每章都配置统一示例视频；到达率按“完成章节总数”推断，假设按顺序学习。
            </p>
          </div>
          <span class="tag tag-warn">到达率推断</span>
        </div>

        <ol v-if="chapterRows.length > 0" class="chapter-list">
          <li v-for="chapter in chapterRows" :key="chapter.idx">
            <RouterLink
              class="chapter-row"
              :to="`${courseLink}/chapters/${chapter.idx}`"
            >
              <span class="chapter-no">{{ String(chapter.idx).padStart(2, '0') }}</span>
              <div class="chapter-info">
                <h3>{{ chapter.title }} <span class="video-inline">▶ 视频</span></h3>
                <p class="chapter-sub">
                  第 {{ chapter.idx }} 章<template v-if="chapter.total > 0">
                    · {{ chapter.reached }}/{{ chapter.total }} 人到达（{{ pct(chapter.reachRate) }}）</template
                  >
                </p>
                <MeterBar
                  v-if="chapter.total > 0"
                  class="chapter-meter"
                  :value="chapter.reachRate"
                />
              </div>
              <span class="chapter-go">查看章节 <span aria-hidden="true">→</span></span>
            </RouterLink>
          </li>
        </ol>

        <EmptyState
          v-else
          title="本课程还没有章节"
          message="章节内容可由管理员在后台添加。"
        />
      </section>

      <aside class="panel side-panel" aria-labelledby="progressTitle">
        <h2 id="progressTitle">学习概览</h2>
        <div class="big-progress">
          <span class="big-value">{{ pct(stats?.completion) }}</span>
          <span class="big-label">平均完成率</span>
          <MeterBar
            :value="completionOf(stats)"
            size="lg"
            label="平均完成率"
          />
        </div>
        <dl class="kv">
          <div><dt>平均测验成绩</dt><dd>{{ dec1(stats?.avgScore) }} 分</dd></div>
          <div><dt>累计学习时长</dt><dd>{{ dec1(stats?.hours) }} 小时</dd></div>
          <div><dt>选课条数</dt><dd>{{ num(stats?.enrollments) }} 条</dd></div>
          <div><dt>无测验成绩</dt><dd>{{ num(stats?.noScoreEnrollments) }} 条</dd></div>
        </dl>
        <p class="side-note">
          指标口径：每条学生 × 课程选课取
          <code>max(chapters_done) / total_chapters</code>，再对选课求平均。
        </p>
        <RouterLink class="btn btn-ghost btn-block" :to="dashboardTo">
          在学习看板中筛选本课程
        </RouterLink>
      </aside>
    </div>
  </template>
</template>

<style scoped>
.crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.crumbs a {
  color: var(--blue);
}

.detail-hero {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 22px;
  align-items: center;
  background:
    radial-gradient(420px 220px at 100% 0%, rgba(47, 120, 196, 0.09), transparent 70%),
    #fff;
  border: 1px solid var(--line);
  border-top: 5px solid var(--accent, var(--blue));
  border-radius: 22px;
  padding: 28px;
  box-shadow: var(--shadow);
}

.detail-badge {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.6px;
  box-shadow: 0 12px 24px -14px rgba(0, 0, 72, 0.55);
}

.detail-copy h1 {
  font-size: clamp(26px, 3.4vw, 38px);
  margin: 6px 0 6px;
}

.detail-copy > p {
  color: var(--muted);
  max-width: 680px;
}

.tag-row {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}

.meta-row {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  color: #7c86a0;
  font-size: 13px;
  margin-top: 12px;
}

.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 150px;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 18px 0;
}

.mini-stat {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 16px 18px;
  box-shadow: var(--shadow);
}

.mini-stat span {
  display: block;
  font-size: 12.5px;
  color: var(--muted);
}

.mini-stat strong {
  display: block;
  font-size: 27px;
  color: var(--navy);
  line-height: 1.25;
  margin: 2px 0;
}

.mini-stat small {
  display: block;
  font-size: 11.5px;
  color: var(--muted-soft);
}

.video-panel {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 0.78fr) minmax(0, 1.22fr);
  gap: 26px;
  align-items: center;
  padding: 24px 26px;
  margin-bottom: 18px;
  border-radius: 22px;
  color: #fff;
  background:
    radial-gradient(460px 220px at 96% 0%, rgba(6, 199, 204, 0.24), transparent 68%),
    linear-gradient(118deg, #00002e 0%, #10236f 58%, #1b3a8c 100%);
  box-shadow: var(--shadow-lg);
}

.video-panel::after {
  content: '';
  position: absolute;
  right: 18px;
  bottom: -46px;
  width: 190px;
  height: 190px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 48px;
  transform: rotate(20deg);
  pointer-events: none;
}

.video-copy {
  position: relative;
  z-index: 1;
}

.video-copy .eyebrow {
  color: #8cf3f5;
}

.video-copy h2 {
  color: #fff;
  font-size: 22px;
  margin: 2px 0 8px;
}

.video-copy p {
  color: #d7dcff;
  font-size: 13.5px;
  max-width: 440px;
}

.video-meta {
  display: flex;
  align-items: center;
  gap: 10px 14px;
  flex-wrap: wrap;
  margin-top: 14px;
  color: #b9c4ff;
  font-size: 12.5px;
}

.tag-video {
  background: rgba(6, 199, 204, 0.18);
  color: #c9fff6;
  border: 1px solid rgba(6, 199, 204, 0.42);
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(280px, 0.85fr);
  gap: 18px;
  align-items: start;
}

.chapter-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
}

.chapter-list li {
  border-bottom: 1px dashed var(--line);
}

.chapter-list li:last-child {
  border-bottom: 0;
}

.chapter-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 10px 13px 4px;
  border-radius: 12px;
  color: inherit;
  text-decoration: none;
  transition: background 0.15s;
}

.chapter-row:hover {
  background: #f7f9fd;
  text-decoration: none;
}

.chapter-row:hover h3 {
  color: var(--blue);
}

.chapter-info {
  flex: 1;
  min-width: 0;
}

.chapter-sub {
  font-size: 12px;
  color: var(--muted);
  margin-top: 1px;
}

.chapter-meter {
  max-width: 320px;
  margin-top: 7px;
}

.chapter-go {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--blue);
  white-space: nowrap;
}

.chapter-no {
  flex: 0 0 38px;
  height: 38px;
  border-radius: 11px;
  background: #eef3fb;
  color: #2f5f9b;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 800;
  font-family: var(--font-mono);
}

.chapter-list h3 {
  font-size: 15px;
  margin-bottom: 2px;
}

.video-inline {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  background: #e9f6f7;
  color: #087d82;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  vertical-align: 2px;
}

.big-progress {
  margin: 10px 0 16px;
}

.big-value {
  display: block;
  font-size: 38px;
  font-weight: 800;
  color: var(--navy);
  line-height: 1.1;
  letter-spacing: -0.5px;
}

.big-label {
  display: block;
  font-size: 12.5px;
  color: var(--muted);
  margin-bottom: 9px;
}

.kv {
  margin: 0;
}

.kv > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 13px;
}

.kv > div:last-child {
  border-bottom: 0;
}

.kv dt {
  color: var(--muted);
}

.kv dd {
  margin: 0;
  font-weight: 600;
  color: var(--ink);
  text-align: right;
}

.side-note {
  font-size: 12px;
  color: var(--muted);
  background: #f7f9fd;
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  padding: 10px 12px;
  margin-top: 12px;
}

@media (max-width: 940px) {
  .detail-hero {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .detail-actions {
    grid-column: 1 / -1;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .stat-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .video-panel {
    grid-template-columns: 1fr;
    padding: 20px 18px;
  }

  .detail-hero {
    padding: 20px 18px;
    gap: 14px;
  }

  .detail-badge {
    width: 56px;
    height: 56px;
    font-size: 14px;
  }

  .chapter-go {
    display: none;
  }
}

@media (max-width: 480px) {
  .stat-row {
    grid-template-columns: 1fr;
  }
}
</style>