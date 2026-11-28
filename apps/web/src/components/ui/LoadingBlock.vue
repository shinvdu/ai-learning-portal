<script setup lang="ts">
withDefaults(
  defineProps<{
    text?: string;
    compact?: boolean;
  }>(),
  { text: '正在加载…', compact: false },
);
</script>

<template>
  <div class="loading" :style="compact ? { minHeight: '120px' } : undefined" role="status">
    <span class="spinner" aria-hidden="true" />
    <span>{{ text }}</span>
  </div>
</template>