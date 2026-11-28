<script setup lang="ts">
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite" aria-atomic="false">
    <div v-for="item in toast.items" :key="item.id" class="toast" :class="item.kind">
      {{ item.message }}
    </div>
  </div>
</template>