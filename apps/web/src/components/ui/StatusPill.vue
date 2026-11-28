<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    tone?: 'ok' | 'off' | 'warn' | 'info' | 'plain';
  }>(),
  { tone: 'plain' },
);

const classes = computed(() => ['status-pill', props.tone !== 'plain' ? props.tone : '']);
</script>

<template>
  <span :class="classes"><slot /></span>
</template>