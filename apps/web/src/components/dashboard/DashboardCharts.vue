<script setup lang="ts">
/**
 * The six dashboard charts (F073).
 *
 * Values always come from the `/dashboard` payload; the option builders only
 * translate them into ECharts. Each chart also supplies a hidden data table.
 */
import { computed } from 'vue';
import type { DashboardResponse } from '@/api/types';
import { pct } from '@/utils/format';
import BaseChart from '@/components/charts/BaseChart.vue';
import ChartCard from './ChartCard.vue';
import {
  BLUE,
  ORANGE,
  PURPLE,
  bucketColumnOption,
  completionBarOption,
  dailyTrendOption,
  learnersBarOption,
  weekdayColumnOption,
} from '@/components/charts/options';

const props = defineProps<{
  data: DashboardResponse;
  compact: boolean;
}>();

const height = computed(() => (props.compact ? 230 : 280));

const colorMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const course of props.data.courseCatalog ?? []) {
    map[course.name] = course.color ?? BLUE;
  }
  return map;
});

/** v1 only plots courses that actually have learners. */
const activeCourses = computed(() => props.data.byCourse.filter((course) => course.learners > 0));

const learnersSorted = computed(() =>
  [...activeCourses.value].sort((a, b) => b.learners - a.learners),
);

const dailyOption = computed(() => dailyTrendOption(props.data.daily, props.compact));
const learnersOption = computed(() =>
  learnersBarOption(activeCourses.value, colorMap.value, props.compact),
);
const completionOption = computed(() =>
  completionBarOption(activeCourses.value, colorMap.value, props.compact),
);
const weekdayOption = computed(() => weekdayColumnOption(props.data.weekday, props.compact));
const completionBucketsOption = computed(() =>
  bucketColumnOption(props.data.completionBuckets, ORANGE, '选课完成率分布。', props.compact),
);
const scoreBucketsOption = computed(() =>
  bucketColumnOption(
    props.data.scoreBuckets,
    PURPLE,
    '测验成绩分布（仅统计有成绩的选课）。',
    props.compact,
  ),
);

const dailyTable = computed(() => ({
  caption: '每日学习趋势数据',
  headers: ['日期', '学习人次', '学习时长（分钟）', '学习人数'],
  rows: props.data.daily.map((point) => [
    point.date,
    point.sessions,
    point.minutes,
    point.students,
  ]),
}));

const learnersTable = computed(() => ({
  caption: '各课程学习人数数据',
  headers: ['课程', '学习人数'],
  rows: learnersSorted.value.map((course) => [course.course_name, course.learners]),
}));

const completionTable = computed(() => ({
  caption: '各课程平均完成率数据',
  headers: ['课程', '平均完成率'],
  rows: activeCourses.value.map((course) => [course.course_name, pct(course.completion)]),
}));

const weekdayTable = computed(() => ({
  caption: '星期学习活跃度数据',
  headers: ['星期', '学习人次', '学习时长（分钟）'],
  rows: props.data.weekday.map((day) => [day.label, day.sessions, day.minutes]),
}));

const completionBucketsTable = computed(() => ({
  caption: '选课完成率分布数据',
  headers: ['完成率区间', '选课数'],
  rows: props.data.completionBuckets.map((bucket) => [bucket.label, bucket.count]),
}));

const scoreBucketsTable = computed(() => ({
  caption: '测验成绩分布数据',
  headers: ['成绩区间', '选课数'],
  rows: props.data.scoreBuckets.map((bucket) => [bucket.label, bucket.count]),
}));
</script>

<template>
  <div class="chart-grid">
    <ChartCard title="每日学习趋势" subtitle="学习人次 / 天" :note="`${data.daily.length} 天`">
      <BaseChart
        :option="dailyOption"
        :empty="data.daily.length === 0"
        chart-label="每日学习人次趋势折线图"
        :height="height"
        :table="dailyTable"
      />
    </ChartCard>

    <ChartCard title="各课程学习人数" subtitle="按学生编号去重" note="人">
      <BaseChart
        :option="learnersOption"
        :empty="activeCourses.length === 0"
        chart-label="各课程学习人数横向条形图"
        :height="height"
        :table="learnersTable"
      />
    </ChartCard>

    <ChartCard title="各课程平均完成率" subtitle="每条选课最大进度 / 总章数" note="%">
      <BaseChart
        :option="completionOption"
        :empty="activeCourses.length === 0"
        chart-label="各课程平均完成率横向条形图"
        :height="height"
        :table="completionTable"
      />
    </ChartCard>

    <ChartCard title="星期学习活跃度" subtitle="学习人次按星期汇总" note="人次">
      <BaseChart
        :option="weekdayOption"
        chart-label="星期学习活跃度柱状图"
        :height="height"
        :table="weekdayTable"
      />
    </ChartCard>

    <ChartCard title="选课完成率分布" subtitle="每条学生 × 课程选课" note="条">
      <BaseChart
        :option="completionBucketsOption"
        chart-label="选课完成率分布柱状图"
        :height="height"
        :table="completionBucketsTable"
      />
    </ChartCard>

    <ChartCard title="测验成绩分布" subtitle="仅统计有成绩的选课" note="条">
      <BaseChart
        :option="scoreBucketsOption"
        chart-label="测验成绩分布柱状图"
        :height="height"
        :table="scoreBucketsTable"
      />
    </ChartCard>
  </div>
</template>
