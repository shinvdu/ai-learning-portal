<script setup lang="ts">
/** Dataset provenance line shown above the KPI grid (v1 parity). */
import type { DatasetMeta } from '@/api/types';
import { fmtTime, num, sourceLabel } from '@/utils/format';

defineProps<{
  dataset: DatasetMeta;
  filter: string | null;
  courseCount: number;
  recordCount: number;
}>();
</script>

<template>
  <p class="dataset-line">
    <span
      >课程 <strong>{{ num(courseCount) }}</strong> 门</span
    >
    <span
      >记录 <strong>{{ num(recordCount) }}</strong> 条</span
    >
    <span
      >数据源：<strong>{{ sourceLabel(dataset.source) }}</strong></span
    >
    <span>最近更新 {{ fmtTime(dataset.updatedAt) }}</span>
    <span>手工修改 {{ num(dataset.manualEdits) }} 次</span>
    <span v-if="filter" class="filter-chip">当前筛选：{{ filter }}</span>
    <span v-else class="filter-chip filter-chip-light">全部课程</span>
  </p>
</template>

<style scoped>
.dataset-line {
  margin: 4px 0 16px;
  font-size: 12.5px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px 16px;
  flex-wrap: wrap;
}

.dataset-line strong {
  color: #3f4a5f;
  font-weight: 600;
}

.filter-chip {
  display: inline-block;
  background: #e9f6f7;
  color: #087d82;
  border: 1px solid #bcebed;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11.5px;
  font-weight: 600;
}

.filter-chip-light {
  background: #f1f3f8;
  color: var(--muted);
  border-color: #e2e6ef;
}
</style>
