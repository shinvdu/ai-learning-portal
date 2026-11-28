<script setup lang="ts">
import { computed } from 'vue';
import { clampPercent } from '@/utils/format';

const props = withDefaults(
  defineProps<{
    value: number | null | undefined;
    /** Accessible name; when omitted the bar is treated as decorative. */
    label?: string;
    color?: string;
    size?: 'sm' | 'lg';
  }>(),
  { size: 'sm' },
);

const percent = computed(() => clampPercent(props.value));
const display = computed(() => Math.round(percent.value));

const style = computed(() =>
  props.color ? { width: `${percent.value}%`, '--accent': props.color } : { width: `${percent.value}%` },
);
</script>

<template>
  <div
    class="meter"
    :class="{ 'meter-lg': size === 'lg' }"
    :role="label ? 'progressbar' : undefined"
    :aria-label="label"
    :aria-valuemin="label ? 0 : undefined"
    :aria-valuemax="label ? 100 : undefined"
    :aria-valuenow="label ? display : undefined"
    :aria-hidden="label ? undefined : true"
  >
    <span :style="style" />
  </div>
</template>