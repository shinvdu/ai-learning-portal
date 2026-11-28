<script setup lang="ts">
import { computed } from 'vue';
import AppButton from './AppButton.vue';
import AppDialog from './AppDialog.vue';
import { resolveConfirm, useConfirmState } from '@/composables/useConfirm';

const state = useConfirmState();

const open = computed({
  get: () => state.open,
  set: (value: boolean) => {
    if (!value) resolveConfirm(false);
  },
});

function accept(): void {
  resolveConfirm(true);
}

function cancel(): void {
  resolveConfirm(false);
}
</script>

<template>
  <AppDialog v-model:open="open" :title="state.options?.title">
    <p class="confirm-message">{{ state.options?.message }}</p>
    <template #footer>
      <AppButton variant="ghost" @click="cancel">
        {{ state.options?.cancelText ?? '取消' }}
      </AppButton>
      <AppButton :variant="state.options?.danger ? 'danger' : 'primary'" @click="accept">
        {{ state.options?.confirmText ?? '确定' }}
      </AppButton>
    </template>
  </AppDialog>
</template>

<style scoped>
.confirm-message {
  color: var(--ink);
  font-size: 14px;
  white-space: pre-line;
}
</style>