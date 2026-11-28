<script setup lang="ts">
import { nextTick, onMounted, ref, useId, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    /** Close when the backdrop is clicked (default true). */
    closeOnBackdrop?: boolean;
  }>(),
  { closeOnBackdrop: true },
);

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const titleId = useId();
let restoreTarget: HTMLElement | null = null;

function openDialog(): void {
  const element = dialog.value;
  if (!element || element.open) return;
  restoreTarget =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  element.showModal();
}

function restoreFocus(): void {
  if (restoreTarget && restoreTarget.isConnected) {
    restoreTarget.focus();
  }
  restoreTarget = null;
}

watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open) openDialog();
    else if (dialog.value?.open) dialog.value.close();
  },
);

onMounted(() => {
  if (props.open) openDialog();
});

function onClose(): void {
  emit('update:open', false);
  restoreFocus();
}

function onCancel(event: Event): void {
  event.preventDefault();
  emit('update:open', false);
}

function onBackdropClick(event: MouseEvent): void {
  if (!props.closeOnBackdrop) return;
  if (event.target === dialog.value) emit('update:open', false);
}
</script>

<template>
  <dialog
    ref="dialog"
    class="app-dialog"
    :aria-labelledby="title ? titleId : undefined"
    @close="onClose"
    @cancel="onCancel"
    @click="onBackdropClick"
  >
    <div class="dialog-inner">
      <header v-if="title || $slots.header" class="dialog-head">
        <h2 v-if="title" :id="titleId">{{ title }}</h2>
        <slot name="header" />
      </header>

      <slot />

      <footer v-if="$slots.footer" class="dialog-foot">
        <slot name="footer" />
      </footer>
    </div>
  </dialog>
</template>