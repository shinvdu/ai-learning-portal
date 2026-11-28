<script setup lang="ts">
import AppButton from './AppButton.vue';

withDefaults(
  defineProps<{
    title?: string;
    message: string;
    retryText?: string;
  }>(),
  { title: '页面加载失败', retryText: '重新加载' },
);

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="error-card" role="alert">
    <h2>{{ title }}</h2>
    <p>{{ message }}</p>
    <AppButton variant="primary" @click="emit('retry')">{{ retryText }}</AppButton>
  </div>
</template>