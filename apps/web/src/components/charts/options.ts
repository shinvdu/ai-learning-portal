/**
 * ECharts option builders for the six dashboard charts (F073).
 *
 * Every value comes from the `/dashboard` payload; only layout/styling lives
 * here. `compact` mirrors the v1 `isCompact()` treatment (≤ 720px): smaller
 * fonts, wrapped course labels and fewer date ticks.
 */
import type { Bucket, CourseStats, DailyPoint, WeekdayStat } from '@/api/types';
import type { ECOption } from './echarts';

const AXIS = '#8A93A6';
const GRID = '#E8EDF5';
const TEXT = '#1D2433';
const BLUE = '#2F78C4';
const TEAL = '#06C7CC';
const ORANGE = '#E8833A';
const PURPLE = '#6C5CE7';

type AxisTooltipParams = { dataIndex?: number };

/** ECharts hands axis tooltips an array; take the first item's index. */
function firstDataIndex(params: unknown): number {
  const first = (Array.isArray(params) ? params[0] : params) as AxisTooltipParams | undefined;
  return first?.dataIndex ?? 0;
}

function axisTickInterval(count: number, compact: boolean): number {
  if (count <= 1) return 0;
  const wanted = compact ? 6 : 9;
  return Math.max(0, Math.ceil(count / wanted) - 1);
}

function shortDateLabel(date: string): string {
  return date.slice(5);
}

export function dailyTrendOption(points: readonly DailyPoint[], compact: boolean): ECOption {
  const tick = axisTickInterval(points.length, compact);
  return {
    animationDuration: 320,
    aria: {
      enabled: true,
      description: `每日学习人次趋势，共 ${points.length} 天。`,
    },
    grid: { left: 4, right: compact ? 10 : 18, top: 20, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: unknown): string => {
        const point = points[firstDataIndex(params)];
        if (!point) return '';
        return (
          `${point.date}<br/>` +
          `学习人次 <strong>${point.sessions}</strong> · 学习时长 <strong>${point.minutes}</strong> 分钟<br/>` +
          `学习人数 <strong>${point.students}</strong> 人`
        );
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((point) => shortDateLabel(point.date)),
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: AXIS,
        fontSize: compact ? 9 : 11,
        hideOverlap: true,
        interval: tick,
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AXIS, fontSize: compact ? 9 : 11 },
    },
    series: [
      {
        name: '学习人次',
        type: 'line',
        data: points.map((point) => point.sessions),
        smooth: 0.25,
        showSymbol: points.length <= 14,
        symbol: 'circle',
        symbolSize: compact ? 5 : 6,
        lineStyle: { width: 2.5, color: BLUE },
        itemStyle: { color: BLUE, borderColor: '#fff', borderWidth: 2 },
        areaStyle: { color: BLUE, opacity: 0.1 },
        emphasis: { focus: 'series' },
      },
    ],
  };
}

function horizontalBarOption(
  names: readonly string[],
  data: Array<{ value: number | null; itemStyle: { color: string } }>,
  options: {
    ariaLabel: string;
    axisMax?: number;
    labelSuffix: string;
    compact: boolean;
  },
): ECOption {
  const { ariaLabel, axisMax, labelSuffix, compact } = options;
  return {
    animationDuration: 320,
    aria: { enabled: true, description: ariaLabel },
    grid: { left: 4, right: compact ? 44 : 54, top: 10, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
    },
    xAxis: {
      type: 'value',
      minInterval: 1,
      max: axisMax,
      splitNumber: 5,
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: {
        color: AXIS,
        fontSize: compact ? 9 : 11,
        formatter: axisMax ? '{value}%' : '{value}',
      },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: [...names],
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: TEXT,
        fontSize: compact ? 10 : 12,
        width: compact ? 88 : 148,
        overflow: 'break',
      },
    },
    series: [
      {
        type: 'bar',
        data,
        barMaxWidth: compact ? 18 : 22,
        itemStyle: { borderRadius: [0, 6, 6, 0] },
        label: {
          show: true,
          position: 'right',
          color: TEXT,
          fontSize: compact ? 10 : 11,
          fontWeight: 600,
          formatter: `{c}${labelSuffix}`,
        },
      },
    ],
  };
}

export function learnersBarOption(
  courses: readonly CourseStats[],
  colorMap: Record<string, string>,
  compact: boolean,
): ECOption {
  const sorted = [...courses].sort((a, b) => b.learners - a.learners);
  return horizontalBarOption(
    sorted.map((course) => course.course_name),
    sorted.map((course) => ({
      value: course.learners,
      itemStyle: { color: colorMap[course.course_name] ?? BLUE },
    })),
    {
      ariaLabel: `各课程学习人数，共 ${courses.length} 门课程。`,
      labelSuffix: ' 人',
      compact,
    },
  );
}

export function completionBarOption(
  courses: readonly CourseStats[],
  colorMap: Record<string, string>,
  compact: boolean,
): ECOption {
  return horizontalBarOption(
    courses.map((course) => course.course_name),
    courses.map((course) => ({
      value: course.completion,
      itemStyle: { color: colorMap[course.course_name] ?? BLUE },
    })),
    {
      ariaLabel: `各课程平均完成率，共 ${courses.length} 门课程。`,
      axisMax: 100,
      labelSuffix: '%',
      compact,
    },
  );
}

export function weekdayColumnOption(weekday: readonly WeekdayStat[], compact: boolean): ECOption {
  return {
    animationDuration: 320,
    aria: { enabled: true, description: '星期学习人次分布。' },
    grid: { left: 4, right: 10, top: 22, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
      formatter: (params: unknown): string => {
        const day = weekday[firstDataIndex(params)];
        if (!day) return '';
        return `${day.label}<br/>学习人次 <strong>${day.sessions}</strong> · 学习时长 <strong>${day.minutes}</strong> 分钟`;
      },
    },
    xAxis: {
      type: 'category',
      data: weekday.map((day) => day.label),
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: { color: AXIS, fontSize: compact ? 9 : 11, interval: 0 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AXIS, fontSize: compact ? 9 : 11 },
    },
    series: [
      {
        type: 'bar',
        data: weekday.map((day) => day.sessions),
        barMaxWidth: compact ? 30 : 46,
        itemStyle: { color: TEAL, borderRadius: [5, 5, 0, 0] },
        label: {
          show: true,
          position: 'top',
          color: TEXT,
          fontSize: compact ? 10 : 11,
          fontWeight: 600,
        },
      },
    ],
  };
}

export function bucketColumnOption(
  buckets: readonly Bucket[],
  color: string,
  ariaLabel: string,
  compact: boolean,
): ECOption {
  return {
    animationDuration: 320,
    aria: { enabled: true, description: ariaLabel },
    grid: { left: 4, right: 10, top: 22, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
      formatter: (params: unknown): string => {
        const bucket = buckets[firstDataIndex(params)];
        if (!bucket) return '';
        return `${bucket.label}：<strong>${bucket.count}</strong> 条选课`;
      },
    },
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => bucket.label),
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: { color: AXIS, fontSize: compact ? 9 : 11, interval: 0 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AXIS, fontSize: compact ? 9 : 11 },
    },
    series: [
      {
        type: 'bar',
        data: buckets.map((bucket) => bucket.count),
        barMaxWidth: compact ? 30 : 44,
        itemStyle: { color, borderRadius: [5, 5, 0, 0] },
        label: {
          show: true,
          position: 'top',
          color: TEXT,
          fontSize: compact ? 10 : 11,
          fontWeight: 600,
          formatter: '{c} 条',
        },
      },
    ],
  };
}

export { BLUE, TEAL, ORANGE, PURPLE };
