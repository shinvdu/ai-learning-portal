<script setup lang="ts">
/** TOTP / recovery-code challenge, shared by login and email verification. */
import { ref } from 'vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { ClientUser } from '@/api/types';

const props = defineProps<{
  challengeToken: string;
  email?: string;
}>();

const emit = defineEmits<{ success: [user: ClientUser] }>();

const auth = useAuthStore();
const code = ref('');
const error = ref<string | null>(null);
const loading = ref(false);

async function onSubmit(): Promise<void> {
  const value = code.value.trim();
  if (!value) {
    error.value = '请输入验证码或恢复码';
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const response = await auth.verifyMfa(props.challengeToken, value);
    emit('success', response.user);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form class="auth-form" @submit.prevent="onSubmit">
    <AppInput
      v-model="code"
      label="验证码"
      name="code"
      placeholder="123456 或 XXXX-XXXX"
      autocomplete="one-time-code"
      hint="输入认证器中的 6 位验证码，或使用一枚恢复码。"
      :maxlength="12"
      :required="true"
      :error="error ?? undefined"
    />
    <AppButton type="submit" variant="primary" block :loading="loading">验证并登录</AppButton>
    <p v-if="email" class="challenge-email">当前账号：{{ email }}</p>
  </form>
</template>

<style scoped>
.challenge-email {
  color: var(--muted);
  font-size: 12.5px;
  margin-top: 4px;
  word-break: break-all;
}
</style>