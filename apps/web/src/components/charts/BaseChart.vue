<script setup lang="ts">
/**
 * Small ECharts wrapper built on the tree-shaken core registration.
 *
 * - initialises lazily and disposes on unmount
 * - resizes with a `ResizeObserver` (no window-resize polling)
 * - exposes a chart label plus a visually hidden data table so the chart is
 *   readable without a pointer or with a screen reader
 * - renders an empty state when there is no data to plot
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { echarts, type EChartsInstance, type ECOption } from './echarts';

const props = withDefaults(
  defineProps<{
    option: ECOption;
    chartLabel: string;
    empty?: boolean;
    emptyText?: string;
    height?: number;
    table?: {
      caption?: string;
      headers: string[];
      rows: Array<Array<string | number>>;
    };
  }>(),
  {
    empty: false,
    emptyText: '当前筛选下暂无数据',
    height: 280,
  },
);

const canvas = ref<HTMLDivElement | null>(null);
let chart: EChartsInstance | null = null;
let observer: ResizeObserver | null = null;

function render(): void {
  if (props.empty || !canvas.value) return;
  if (!chart) chart = echarts.init(canvas.value);
  chart.setOption(props.option, { notMerge: true });
  chart.resize();
}

onMounted(() => {
  if (!canvas.value) return;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => chart?.resize());
    observer.observe(canvas.value);
  }
  render();
});

watch(
  () => props.option,
  () => render(),
  { deep: true },
);

watch(
  () => props.empty,
  async (empty) => {
    if (empty) return;
    await nextTick();
    render();
  },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div class="chart-block">
    <div
      v-show="!empty"
      ref="canvas"
      class="chart-canvas"
      :style="{ height: `${height}px` }"
      role="img"
      :aria-label="chartLabel"
    />
    <p v-if="empty" class="empty-chart" role="status">{{ emptyText }}</p>

    <div v-if="!empty && table" class="sr-only">
      <table>
        <caption>
          {{
            table.caption ?? chartLabel
          }}
        </caption>
        <thead>
          <tr>
            <th v-for="header in table.headers" :key="header" scope="col">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in table.rows" :key="rowIndex">
            <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.chart-canvas {
  width: 100%;
  min-width: 0;
}
</style>
