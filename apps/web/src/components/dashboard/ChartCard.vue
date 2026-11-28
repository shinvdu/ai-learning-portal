<script setup lang="ts">
/** Titled card that wraps a BaseChart, keeping v1 chart-card styling. */
defineProps<{
  title: string;
  subtitle: string;
  note?: string;
}>();
</script>

<template>
  <article class="chart-card">
    <header>
      <div>
        <h3>{{ title }}</h3>
        <p>{{ subtitle }}</p>
      </div>
      <span v-if="note" class="chart-note">{{ note }}</span>
    </header>
    <div class="chart-body">
      <slot />
    </div>
  </article>
</template>
