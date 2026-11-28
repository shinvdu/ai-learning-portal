<script setup lang="ts">
const props = defineProps<{ tabs: { id: string; label: string }[]; label?: string }>();
const model = defineModel<string>({ required: true });

function onKeydown(event: KeyboardEvent, index: number): void {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();

  const last = props.tabs.length - 1;
  let next = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = index >= last ? 0 : index + 1;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = index <= 0 ? last : index - 1;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = last;
  }

  const target = props.tabs[next];
  if (!target) return;
  model.value = target.id;

  const list = (event.currentTarget as HTMLElement).parentElement;
  list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}
</script>

<template>
  <div class="tabs" role="tablist" :aria-label="label">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.id"
      type="button"
      class="tab"
      role="tab"
      :aria-selected="model === tab.id"
      :tabindex="model === tab.id ? 0 : -1"
      @click="model = tab.id"
      @keydown="onKeydown($event, index)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>