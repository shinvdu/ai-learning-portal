<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { passwordProblem } from '@/components/account/authHelpers';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

const route = useRoute();
const auth = useAuthStore();
const toast = useToastStore();

const token = computed(() => {
  const raw = route.query.token;
  return typeof raw === 'string' ? raw : '';
});

const password = ref('');
const confirmPassword = ref('');
const error = ref<string | null>(null);
const confirmError = ref<string | null>(null);
const loading = ref(false);
const done = ref(false);

async function onSubmit(): Promise<void> {
  error.value = null;
  confirmError.value = null;
  const problem = passwordProblem(password.value);
  if (problem) {
    error.value = problem;
    return;
  }
  if (password.value !== confirmPassword.value) {
    confirmError.value = '两次输入的密码不一致';
    return;
  }
  loading.value = true;
  try {
    await authApi.resetPassword(token.value, password.value);
    // All sessions (including any cached identity) are invalidated server-side.
    auth.setUser(null);
    done.value = true;
    toast.ok('密码已重置');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="panel auth-card">
      <span class="eyebrow">ACCOUNT RECOVERY</span>

      <template v-if="!token">
        <h1>链接无效</h1>
        <p class="auth-sub">链接缺少 token，请从邮件中重新打开。</p>
        <div class="form-actions">
          <AppButton variant="primary" to="/login">返回登录</AppButton>
          <AppButton variant="ghost" to="/forgot">重新发送邮件</AppButton>
        </div>
      </template>

      <template v-else-if="done">
        <h1>密码已重置</h1>
        <p class="auth-sub">旧会话已全部失效，请使用新密码登录。</p>
        <div class="form-actions">
          <AppButton variant="primary" to="/login">去登录</AppButton>
        </div>
      </template>

      <template v-else>
        <h1>重置密码</h1>
        <p class="auth-sub">设置一个新的密码，重置后所有旧会话都会失效。</p>
        <form class="auth-form" @submit.prevent="onSubmit">
          <AppInput
            v-model="password"
            label="新密码"
            name="password"
            type="password"
            autocomplete="new-password"
            placeholder="至少 8 个字符"
            :minlength="8"
            :required="true"
          />
          <AppInput
            v-model="confirmPassword"
            label="确认新密码"
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="再次输入密码"
            :minlength="8"
            :required="true"
            :error="confirmError ?? undefined"
          />
          <div v-if="error" class="form-error" role="alert">{{ error }}</div>
          <AppButton type="submit" variant="primary" block :loading="loading">
            重置密码
          </AppButton>
        </form>
        <p class="auth-alt"><RouterLink to="/login">返回登录</RouterLink></p>
      </template>
    </div>

    <aside class="auth-aside" aria-label="重置密码说明">
      <h2>安全提示</h2>
      <p class="muted">
        重置链接 1 小时内有效，且只能使用一次。请勿在公共设备上保存新密码。
      </p>
    </aside>
  </section>
</template>