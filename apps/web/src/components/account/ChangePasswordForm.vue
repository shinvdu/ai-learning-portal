<script setup lang="ts">
/** Change password while keeping the current session (F081). */
import { ref } from 'vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { useToastStore } from '@/stores/toast';
import { passwordProblem } from './authHelpers';

const toast = useToastStore();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const newError = ref<string | null>(null);
const confirmError = ref<string | null>(null);
const formError = ref<string | null>(null);
const loading = ref(false);

function validate(): boolean {
  newError.value = null;
  confirmError.value = null;
  formError.value = null;
  const problem = passwordProblem(newPassword.value);
  if (problem) {
    newError.value = problem;
    return false;
  }
  if (newPassword.value !== confirmPassword.value) {
    confirmError.value = '两次输入的新密码不一致';
    return false;
  }
  if (!currentPassword.value) {
    formError.value = '请输入当前密码';
    return false;
  }
  return true;
}

async function onSubmit(): Promise<void> {
  if (!validate()) return;
  loading.value = true;
  try {
    await authApi.changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    toast.ok('密码已更新，其他设备已退出');
  } catch (err) {
    formError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="panel">
    <h2>修改密码</h2>
    <p class="panel-sub">修改后会撤销其他设备上的会话，当前会话保持登录。</p>

    <form class="auth-form" @submit.prevent="onSubmit">
      <AppInput
        v-model="currentPassword"
        label="当前密码"
        name="currentPassword"
        type="password"
        autocomplete="current-password"
        :required="true"
      />
      <AppInput
        v-model="newPassword"
        label="新密码"
        name="newPassword"
        type="password"
        autocomplete="new-password"
        placeholder="至少 8 个字符"
        :minlength="8"
        :required="true"
        :error="newError ?? undefined"
      />
      <AppInput
        v-model="confirmPassword"
        label="确认新密码"
        name="confirmPassword"
        type="password"
        autocomplete="new-password"
        :minlength="8"
        :required="true"
        :error="confirmError ?? undefined"
      />
      <div v-if="formError" class="form-error" role="alert">{{ formError }}</div>
      <AppButton type="submit" variant="primary" :loading="loading">更新密码</AppButton>
    </form>
  </section>
</template>