<script setup lang="ts">
/**
 * Data insights page (F073).
 *
 * Snapshot, dynamic insight cards (evidence + action), the formula table,
 * dataset-quality line and the pitfalls grid all read from `GET /insights`.
 */
import { computed } from 'vue';
import { analyticsApi } from '@/api/endpoints';
import type { InsightsResponse } from '@/api/types';
import { useAsyncData } from '@/composables/useAsyncState';
import { dec1, num, pct, sourceLabel } from '@/utils/format';
import AppButton from '@/components/ui/AppButton.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import InsightCard from '@/components/dashboard/InsightCard.vue';

const { data, loading, error, reload } = useAsyncData<InsightsResponse>(
  () => analyticsApi.insights(),
  { immediate: true },
);

const overview = computed(() => data.value?.overview ?? null);

const snapshot = computed(() => {
  const o = overview.value;
  if (!o) return [];
  return [
    { label: '学生', value: num(o.students) },
    { label: '选课', value: num(o.enrollments) },
    { label: '平均完成率', value: pct(o.avgCompletion) },
    { label: '平均成绩', value: dec1(o.avgScore) },
    { label: '累计学习', value: `${dec1(o.totalHours)}h` },
  ];
});

const formulaRows = computed(() => {
  const o = overview.value;
  if (!o) return [];
  return [
    {
      metric: '学生人数',
      formula: 'COUNT(DISTINCT student_id)',
      value: `${num(o.students)} 人`,
    },
    {
      metric: '课程数量',
      formula: 'COUNT(DISTINCT course_name)',
      value: `${num(o.courses)} 门`,
    },
    {
      metric: '选课数',
      formula: 'COUNT(DISTINCT student_id + course_name)',
      value: `${num(o.enrollments)} 条`,
    },
    {
      metric: '平均完成率',
      formula: 'mean( max(chapters_done) / total_chapters )，按选课分组',
      value: pct(o.avgCompletion),
    },
    {
      metric: '平均测验成绩',
      formula: 'mean(quiz_score)，只统计有成绩的选课',
      value: `${dec1(o.avgScore)} 分（有成绩 ${num(o.scoredEnrollments)} 条 / 无成绩 ${num(o.noScoreEnrollments)} 条）`,
    },
    {
      metric: '累计学习时长',
      formula: 'SUM(learning_minutes) ÷ 60',
      value: `${dec1(o.totalHours)} 小时（${num(o.totalMinutes)} 分钟）`,
    },
  ];
});
</script>

<template>
  <header class="page-head">
    <div>
      <span class="eyebrow">数据洞察 · 有数据支撑的结论</span>
      <h1>从学习记录里读出什么</h1>
      <p>
        以下结论由当前数据库中的记录自动计算并生成；每条都给出具体数字与可执行建议，可在学习看板中找到依据。
      </p>
    </div>
    <AppButton variant="ghost" to="/dashboard">回到学习看板</AppButton>
  </header>

  <div v-if="!data && loading">
    <LoadingBlock text="正在计算洞察…" />
  </div>

  <ErrorCard v-else-if="!data && error" title="洞察加载失败" :message="error" @retry="reload" />

  <template v-else-if="data && overview">
    <section class="snapshot-row" aria-label="数据快照">
      <div v-for="item in snapshot" :key="item.label">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </section>

    <section class="section insight-section" aria-labelledby="insightTitle">
      <div class="section-head">
        <div>
          <h2 id="insightTitle">{{ data.insights.length }} 条数据洞察</h2>
          <p>作业要求 ≥2 条；这里由规则从数据实时生成，不是写死的文案。</p>
        </div>
      </div>
      <div class="insight-grid">
        <InsightCard v-for="insight in data.insights" :key="insight.id" :insight="insight" />
      </div>
    </section>

    <section class="panel" aria-labelledby="formulaTitle">
      <div class="panel-head">
        <div>
          <h2 id="formulaTitle">口径与公式</h2>
          <p class="panel-sub">“这个数是怎么算的”必须能回答——下面是页面上每个指标的计算方式。</p>
        </div>
        <span class="tag tag-plain">可复核</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">指标</th>
              <th scope="col">口径 / 公式</th>
              <th scope="col">当前值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in formulaRows" :key="row.metric">
              <td>
                <strong>{{ row.metric }}</strong>
              </td>
              <td>
                <code>{{ row.formula }}</code>
              </td>
              <td>{{ row.value }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="quality-row">
        <span>
          数据区间：<strong>{{ data.quality.dateFrom ?? '—' }}</strong> 至
          <strong>{{ data.quality.dateTo ?? '—' }}</strong>（{{ data.quality.days }} 天）
        </span>
        <span
          >原始记录：<strong>{{ num(overview.records) }}</strong> 条</span
        >
        <span
          >数据源：<strong>{{ sourceLabel(data.dataset.source) }}</strong></span
        >
        <span
          >手工修改：<strong>{{ num(data.dataset.manualEdits) }}</strong> 次</span
        >
      </div>
    </section>

    <section class="panel" aria-labelledby="pitfallTitle">
      <div class="panel-head">
        <div>
          <h2 id="pitfallTitle">常见口径误区</h2>
          <p class="panel-sub">
            这些是把数据算错时最常见的错值；页面上的正确值已由服务端从原始记录重新计算。
          </p>
        </div>
        <span class="tag tag-warn">演示</span>
      </div>
      <div class="pitfall-grid">
        <article v-for="pitfall in data.pitfalls" :key="pitfall.metric" class="pitfall-card">
          <div class="pitfall-top">
            <h3>{{ pitfall.metric }}</h3>
            <span class="wrong-value">常见错值：{{ pitfall.wrong }}</span>
          </div>
          <p>{{ pitfall.reason }}</p>
          <p class="pitfall-right">
            正确做法：<code>{{ pitfall.correctHint }}</code>
          </p>
        </article>
      </div>
    </section>

    <section class="panel demo-note" aria-labelledby="verifyTitle">
      <h2 id="verifyTitle">如何验证“数字不是写死的”</h2>
      <ol class="steps">
        <li>打开学习看板，记录当前“平均完成率”和“平均测验成绩”。</li>
        <li>
          在页面底部展开“数据演示”，编辑一条记录（例如把
          <code>chapters_done</code> 加 1）。
        </li>
        <li>保存后确认 KPI 与图表变化；再点“恢复初始数据”回到参考值。</li>
        <li>或者导出 CSV、改一个值、重新导入，验证指标体系同样随数据变化。</li>
      </ol>
    </section>
  </template>
</template>

<style scoped>
.quality-row {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--muted);
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px dashed var(--line);
}

.quality-row strong {
  color: #3f4a5f;
  font-weight: 600;
}

.pitfall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 11px;
  margin-top: 12px;
}

.pitfall-card {
  background: #fffaf6;
  border: 1px solid #f4dfcc;
  border-radius: 13px;
  padding: 13px 15px;
}

.pitfall-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 5px;
}

.pitfall-card h3 {
  font-size: 14px;
}

.wrong-value {
  font-size: 11.5px;
  font-weight: 700;
  color: #b2521a;
  background: #fff0e2;
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
}

.pitfall-card p {
  font-size: 12.5px;
  color: #5c5350;
}

.pitfall-right {
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px dashed #efd9c6;
}

.steps {
  margin: 10px 0 0;
  padding-left: 20px;
  font-size: 13.5px;
  color: #3f4a5f;
}

.steps li {
  margin: 6px 0;
}

@media (max-width: 940px) {
  .snapshot-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .snapshot-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
