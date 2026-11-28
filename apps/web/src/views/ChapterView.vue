<script setup lang="ts">
/**
 * F071 · 章节学习页.
 *
 * `GET /chapters/:courseId/:idx` returns the chapter body, video, inferred
 * reach stats, the quiz questions sourced from this chapter and only the
 * adjacent indexes that actually exist (`prev` / `next` may be null).
 * Lecture text is rendered as paragraphs/lists, never with `v-html`.
 */
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ApiError, errorMessage } from '@/api/client';
import { catalogApi } from '@/api/endpoints';
import type { ChapterResponse, ChapterStat } from '@/api/types';
import ChapterQuiz from '@/components/course/ChapterQuiz.vue';
import ChapterReachList from '@/components/course/ChapterReachList.vue';
import LectureText from '@/components/course/LectureText.vue';
import VideoPlayer from '@/components/course/VideoPlayer.vue';
import { courseColor, videoDuration } from '@/components/course/course';
import AppButton from '@/components/ui/AppButton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import MeterBar from '@/components/ui/MeterBar.vue';
import { clampPercent, dec1, num, pct } from '@/utils/format';

const route = useRoute();

const data = ref<ChapterResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const status = ref<number | null>(null);
let requestId = 0;

async function load(): Promise<void> {
  const courseId = String(route.params.courseId ?? '');
  const idx = String(route.params.idx ?? '');
  const current = ++requestId;
  loading.value = true;
  error.value = null;
  status.value = null;
  try {
    const result = await catalogApi.chapter(courseId, idx);
    if (current !== requestId) return;
    data.value = result;
  } catch (thrown) {
    if (current !== requestId) return;
    data.value = null;
    status.value = thrown instanceof ApiError ? thrown.status : 0;
    error.value = errorMessage(thrown, '章节加载失败');
  } finally {
    if (current === requestId) loading.value = false;
  }
}

watch(
  [() => route.params.courseId, () => route.params.idx],
  () => void load(),
  { immediate: true },
);

const course = computed(() => data.value?.course ?? null);
const chapter = computed(() => data.value?.chapter ?? null);
const stats = computed(() => data.value?.stats ?? null);
const allChapters = computed<ChapterStat[]>(() => data.value?.chapterStats ?? []);
const quiz = computed(() => data.value?.relatedQuiz ?? []);
const prev = computed(() => data.value?.prev ?? null);
const next = computed(() => data.value?.next ?? null);
const accent = computed(() => courseColor(course.value));
const notFound = computed(() => status.value === 404);

const courseLink = computed(() => `/courses/${encodeURIComponent(course.value?.id ?? '')}`);
const knowledgeLink = computed(() => `/knowledge/${encodeURIComponent(course.value?.id ?? '')}`);
const dashboardTo = computed(() => ({
  path: '/dashboard',
  query: course.value ? { course: course.value.name } : {},
}));
const chapterLink = (idx: number): string => `${courseLink.value}/chapters/${idx}`;
const videoLabel = computed(() =>
  course.value && chapter.value
    ? `${course.value.name} 第 ${chapter.value.idx} 章示例视频`
    : '章节示例视频',
);

function scoreDetail(value: number | null, count: number): string {
  if (value === null || value === undefined) return '—（无成绩）';
  return `${dec1(value)} 分（${num(count)} 条）`;
}
</script>

<template>
  <LoadingBlock v-if="loading" text="正在加载章节…" />

  <EmptyState
    v-else-if="notFound"
    title="章节不存在"
    :message="error ?? '该章节可能已被删除，或链接有误。'"
  >
    <AppButton variant="ghost" size="sm" to="/">返回课程广场</AppButton>
  </EmptyState>

  <ErrorCard v-else-if="error" title="章节加载失败" :message="error" @retry="load" />

  <template v-else-if="course && chapter">
    <nav class="crumbs" aria-label="面包屑">
      <RouterLink to="/">课程广场</RouterLink>
      <span aria-hidden="true">/</span>
      <RouterLink :to="courseLink">{{ course.name }}</RouterLink>
      <span aria-hidden="true">/</span>
      <span>第 {{ chapter.idx }} 章</span>
    </nav>

    <header class="chapter-head" :style="{ '--accent': accent }">
      <div>
        <span class="eyebrow">第 {{ chapter.idx }} 章 · {{ course.name }}</span>
        <h1>{{ chapter.title }}</h1>
        <p>
          本章正文取自课程讲义原文；学习数据为按“完成章节总数”推断的参考值，不是逐章原始记录。
        </p>
        <div class="tag-row">
          <span class="tag">讲义原文</span>
          <span class="tag tag-plain">推断数据</span>
          <span class="tag tag-plain">{{ course.chapters.length }} 章课程</span>
        </div>
      </div>
      <div class="chapter-head-actions">
        <RouterLink class="btn btn-ghost" :to="courseLink">返回课程</RouterLink>
        <RouterLink class="btn btn-ghost" :to="knowledgeLink">知识中心</RouterLink>
      </div>
    </header>

    <div class="chapter-layout">
      <div class="chapter-main">
        <section class="panel" aria-labelledby="chapterVideoTitle">
          <div class="panel-head">
            <div>
              <h2 id="chapterVideoTitle">本章示例视频</h2>
              <p class="panel-sub">{{ chapter.video.note }}</p>
            </div>
            <span class="tag tag-video-light">统一示例</span>
          </div>
          <VideoPlayer
            class="chapter-video-frame"
            :video="chapter.video"
            :label="videoLabel"
          />
          <p class="video-caption">
            时长 {{ videoDuration(chapter.video) }} · 无音频 · 所有章节共用同一片段，正式课程可按章节替换。
          </p>
        </section>

        <section class="panel" aria-labelledby="lectureTitle">
          <div class="panel-head">
            <div>
              <h2 id="lectureTitle">本章原文</h2>
              <p class="panel-sub">
                来源：{{ course.name }} · 课程讲义（未加入原文之外的内容）。
              </p>
            </div>
            <span class="tag">原文</span>
          </div>
          <LectureText :body="chapter.body" />
        </section>

        <section class="panel" aria-labelledby="chapterQuizTitle">
          <div class="panel-head">
            <div>
              <h2 id="chapterQuizTitle">本章小测验</h2>
              <p class="panel-sub">
                {{
                  quiz.length > 0
                    ? `${quiz.length} 道题，答案、解析与讲义出处一并给出。`
                    : '本章暂无对应测验，可到知识中心完成课程测验。'
                }}
              </p>
            </div>
            <span v-if="quiz.length > 0" class="tag">可交互</span>
          </div>

          <ChapterQuiz v-if="quiz.length > 0" :quiz="quiz" />
          <RouterLink v-else class="btn btn-ghost btn-sm" :to="knowledgeLink">
            去知识中心 →
          </RouterLink>
        </section>

        <nav v-if="prev || next" class="chapter-pager" aria-label="章节导航">
          <RouterLink v-if="prev" class="chapter-pager-link" :to="chapterLink(prev.idx)">
            <span>← 上一章</span>
            <strong>第 {{ prev.idx }} 章 · {{ prev.title }}</strong>
          </RouterLink>
          <span v-else />

          <RouterLink
            v-if="next"
            class="chapter-pager-link next"
            :to="chapterLink(next.idx)"
          >
            <span>下一章 →</span>
            <strong>第 {{ next.idx }} 章 · {{ next.title }}</strong>
          </RouterLink>
          <span v-else />
        </nav>
      </div>

      <aside class="chapter-side">
        <section class="panel" aria-labelledby="chapterDataTitle">
          <div class="panel-head">
            <div>
              <h2 id="chapterDataTitle">本章学习数据</h2>
              <p class="panel-sub">推断口径 · 假设按顺序学习</p>
            </div>
            <span class="tag tag-warn">推断值</span>
          </div>

          <div class="chapter-rate">
            <strong>{{ pct(stats?.reachRate) }}</strong>
            <span>到达率</span>
          </div>
          <MeterBar
            :value="clampPercent(stats?.reachRate)"
            size="lg"
            label="本章到达率"
          />

          <dl class="kv">
            <div>
              <dt>到达本章</dt>
              <dd>{{ num(stats?.reached) }} / {{ num(stats?.total) }} 人</dd>
            </div>
            <div>
              <dt>尚未到达</dt>
              <dd>{{ num(stats?.notReached) }} 人</dd>
            </div>
            <div>
              <dt>到达者平均成绩</dt>
              <dd>{{ scoreDetail(stats?.avgScoreReached ?? null, stats?.scoredReached ?? 0) }}</dd>
            </div>
            <div>
              <dt>未到达者平均成绩</dt>
              <dd>{{ scoreDetail(stats?.avgScoreNotReached ?? null, stats?.scoredNotReached ?? 0) }}</dd>
            </div>
          </dl>

          <p class="side-note">
            原始 CSV 只记录“完成章节总数”，没有逐章记录。到达率 =
            <code>max(chapters_done) ≥ 本章序号</code> 的选课数 ÷ 本课程选课数。
            仅用于演示与趋势参考，不能当作逐章原始数据。
          </p>
          <RouterLink class="btn btn-ghost btn-block" :to="dashboardTo">
            查看课程看板
          </RouterLink>
        </section>

        <section v-if="allChapters.length > 0" class="panel" aria-labelledby="allChaptersTitle">
          <h2 id="allChaptersTitle">各章节到达率</h2>
          <p class="panel-sub">同一推断口径，用于比较章节之间的差异。</p>
          <ChapterReachList
            :chapters="allChapters"
            :course-id="course.id"
            :current-idx="chapter.idx"
          />
        </section>

        <section class="panel">
          <h2>继续学习</h2>
          <div class="side-links">
            <RouterLink class="btn btn-primary btn-block" :to="courseLink">
              课程详情与导览视频
            </RouterLink>
            <RouterLink class="btn btn-ghost btn-block" :to="knowledgeLink">
              课程知识中心
            </RouterLink>
          </div>
        </section>
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

.chapter-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 22px;
  flex-wrap: wrap;
  padding: 26px 28px;
  margin-bottom: 18px;
  background:
    radial-gradient(420px 220px at 100% 0%, rgba(47, 120, 196, 0.09), transparent 70%),
    #fff;
  border: 1px solid var(--line);
  border-top: 5px solid var(--accent, var(--blue));
  border-radius: 22px;
  box-shadow: var(--shadow);
}

.chapter-head h1 {
  font-size: clamp(28px, 3.4vw, 40px);
  margin: 4px 0 8px;
}

.chapter-head p {
  color: var(--muted);
  font-size: 14px;
  max-width: 720px;
}

.tag-row {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.chapter-head-actions {
  display: flex;
  gap: 9px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.chapter-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 0.9fr);
  gap: 18px;
  align-items: start;
}

.chapter-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.chapter-side {
  position: sticky;
  top: 84px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chapter-video-frame {
  margin-top: 2px;
  border-color: var(--line);
  box-shadow: 0 12px 30px -24px rgba(12, 27, 98, 0.5);
}

.tag-video-light {
  background: #e9f6f7;
  color: #087d82;
  border: 1px solid #bcebed;
}

.video-caption {
  margin-top: 9px;
  font-size: 12px;
  color: var(--muted);
}

.chapter-rate {
  margin: 14px 0 8px;
}

.chapter-rate strong {
  display: block;
  font-size: 38px;
  font-weight: 800;
  color: var(--navy);
  line-height: 1.1;
  letter-spacing: -0.5px;
}

.chapter-rate span {
  font-size: 12.5px;
  color: var(--muted);
}

.kv {
  margin: 12px 0 0;
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
  margin: 12px 0;
}

.chapter-pager {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.chapter-pager-link {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
  text-decoration: none;
}

.chapter-pager-link.next {
  text-align: right;
  margin-left: auto;
}

.chapter-pager-link span {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--blue);
}

.chapter-pager-link strong {
  font-size: 13.5px;
  color: var(--navy);
}

.side-links .btn-block {
  margin-top: 8px;
}

@media (max-width: 940px) {
  .chapter-layout {
    grid-template-columns: 1fr;
  }

  .chapter-side {
    position: static;
  }
}

@media (max-width: 720px) {
  .chapter-head {
    padding: 20px 18px;
    gap: 14px;
  }

  .chapter-pager {
    flex-direction: column;
  }

  .chapter-pager-link.next {
    text-align: left;
  }
}
</style>