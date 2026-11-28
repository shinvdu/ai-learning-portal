<script setup lang="ts">
/** Dynamic insight card with evidence and (optionally) the action suggestion. */
import { computed } from 'vue';
import type { Insight } from '@/api/types';
import { insightAccent } from './insightAccent';

const props = withDefaults(
  defineProps<{
    insight: Insight;
    showAction?: boolean;
  }>(),
  { showAction: true },
);

const accent = computed(() => insightAccent(props.insight.type));
</script>

<template>
  <article class="insight-card" :data-type="insight.type" :style="{ '--accent': accent }">
    <span class="insight-tag">{{ insight.tag }}</span>
    <h3>{{ insight.title }}</h3>
    <p class="insight-evidence">{{ insight.evidence }}</p>
    <p v-if="showAction" class="insight-action"><strong>建议：</strong>{{ insight.action }}</p>
  </article>
</template>

<style scoped>
.insight-evidence {
  line-height: 1.7;
}
</style>
