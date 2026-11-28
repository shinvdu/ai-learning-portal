<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'light' | 'ghost' | 'danger';
    size?: 'md' | 'sm';
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
    to?: string;
    href?: string;
    ariaLabel?: string;
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
  },
);

const emit = defineEmits<{ click: [event: MouseEvent] }>();

const classes = computed(() => [
  'btn',
  `btn-${props.variant}`,
  props.size === 'sm' ? 'btn-sm' : '',
  props.block ? 'btn-block' : '',
]);

const isDisabled = computed(() => props.disabled || props.loading);

function onClick(event: MouseEvent): void {
  if (isDisabled.value) {
    event.preventDefault();
    return;
  }
  emit('click', event);
}
</script>

<template>
  <RouterLink
    v-if="to"
    :to="to"
    :class="classes"
    :aria-label="ariaLabel"
    :aria-disabled="isDisabled || undefined"
    :tabindex="isDisabled ? -1 : undefined"
    @click="onClick"
  >
    <span v-if="loading" class="spinner spinner-sm" aria-hidden="true" />
    <slot />
  </RouterLink>

  <a
    v-else-if="href"
    :href="href"
    :class="classes"
    :aria-label="ariaLabel"
    :aria-disabled="isDisabled || undefined"
    :tabindex="isDisabled ? -1 : undefined"
    @click="onClick"
  >
    <span v-if="loading" class="spinner spinner-sm" aria-hidden="true" />
    <slot />
  </a>

  <button
    v-else
    :type="type"
    :class="classes"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    :aria-label="ariaLabel"
    @click="onClick"
  >
    <span v-if="loading" class="spinner spinner-sm" aria-hidden="true" />
    <slot />
  </button>
</template>