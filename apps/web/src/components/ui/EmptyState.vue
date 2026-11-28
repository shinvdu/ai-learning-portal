<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    message?: string;
  }>(),
  { title: '暂无内容' },
);
</script>

<template>
  <div class="empty-state" role="status">
    <h2 v-if="title">{{ title }}</h2>
    <p v-if="message">{{ message }}</p>
    <slot />
  </div>
</template>