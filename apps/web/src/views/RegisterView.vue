<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { errorCode, passwordProblem } from '@/components/account/authHelpers';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();

const name = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const error = ref<string | null>(null);
const confirmError = ref<string | null>(null);
const loading = ref(false);

/** Set once the API requires email verification (production) or mail failed. */
const sentTo = ref('');
const mailFailed = ref(false);
const resending = ref(false);

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
    const response = await auth.register({
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
    });
    if ('user' in response) {
      // Development auto-verifies and signs the user in.
      toast.ok('注册成功');
      void router.replace(response.user.role === 'admin' ? '/admin' : '/');
      return;
    }
    sentTo.value = response.email;
    mailFailed.value = false;
    toast.info('验证邮件已发送');
  } catch (err) {
    if (errorCode(err) === 'MAIL_FAILED') {
      // The account exists; surface the verification-sent state with a retry.
      sentTo.value = email.value.trim();
      mailFailed.value = true;
    } else {
      error.value = errorMessage(err);
    }
  } finally {
    loading.value = false;
  }
}

async function resend(): Promise<void> {
  if (!sentTo.value || resending.value) return;
  resending.value = true;
  try {
    const response = await authApi.resendVerification(sentTo.value);
    toast.ok(response.message || '如果邮箱存在，验证邮件将很快送达');
  } catch (err) {
    toast.error(errorMessage(err));
  } finally {
    resending.value = false;
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="panel auth-card">
      <span class="eyebrow">AI LEARNING PORTAL</span>

      <template v-if="sentTo">
        <h1>验证邮件已发送</h1>
        <p class="auth-sub">
          我们已向 <strong>{{ sentTo }}</strong> 发送验证链接。请打开邮件完成验证；链接 24 小时内有效。
        </p>
        <div v-if="mailFailed" class="form-error" role="alert">
          账号已创建，但验证邮件发送失败，请稍后重发。
        </div>
        <div class="form-actions">
          <AppButton variant="primary" :loading="resending" @click="resend">重发验证邮件</AppButton>
          <AppButton variant="ghost" to="/login">去登录</AppButton>
        </div>
        <p class="auth-alt">开发环境未配置邮件网关时，验证链接会打印在服务端控制台。</p>
      </template>

      <template v-else>
        <h1>创建账号</h1>
        <p class="auth-sub">注册后即可浏览课程；管理员可在后台管理用户与课程。</p>
        <form class="auth-form" @submit.prevent="onSubmit">
          <AppInput
            v-model="name"
            label="姓名"
            name="name"
            autocomplete="name"
            placeholder="你的名字"
            :maxlength="60"
            :required="true"
          />
          <AppInput
            v-model="email"
            label="邮箱"
            name="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            :maxlength="160"
            :required="true"
          />
          <AppInput
            v-model="password"
            label="密码"
            name="password"
            type="password"
            autocomplete="new-password"
            placeholder="至少 8 个字符"
            :minlength="8"
            :required="true"
          />
          <AppInput
            v-model="confirmPassword"
            label="确认密码"
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="再次输入密码"
            :minlength="8"
            :required="true"
            :error="confirmError ?? undefined"
          />
          <div v-if="error" class="form-error" role="alert">{{ error }}</div>
          <AppButton type="submit" variant="primary" block :loading="loading">注册</AppButton>
        </form>
        <p class="auth-alt">已有账号？<RouterLink to="/login">直接登录</RouterLink></p>
      </template>
    </div>

    <aside class="auth-aside" aria-label="注册说明">
      <h2>注册流程</h2>
      <ul>
        <li>填写姓名、邮箱与至少 8 位密码</li>
        <li>查收验证邮件（24 小时内有效）</li>
        <li>验证成功后自动登录</li>
      </ul>
      <h2>安全提示</h2>
      <p class="muted">请使用模拟信息注册；本网站仅用于课程演示。</p>
    </aside>
  </section>
</template>