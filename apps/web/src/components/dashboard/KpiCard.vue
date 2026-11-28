<script setup lang="ts">
/** One of the five dashboard KPI cards (F073). Values are pre-formatted by the view. */
withDefaults(
  defineProps<{
    label: string;
    display: string;
    unit: string;
    hint: string;
    color?: string;
  }>(),
  { color: '#2F78C4' },
);
</script>

<template>
  <article class="kpi-card" :style="{ '--kpi': color }">
    <span class="kpi-label">{{ label }}</span>
    <div class="kpi-value">
      {{ display }}<small>{{ unit }}</small>
    </div>
    <p class="kpi-hint">{{ hint }}</p>
  </article>
</template>
