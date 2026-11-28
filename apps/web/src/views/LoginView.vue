<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import MfaChallengeForm from '@/components/account/MfaChallengeForm.vue';
import { errorCode, safeRedirect } from '@/components/account/authHelpers';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { ClientUser } from '@/api/types';

const auth = useAuthStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const loading = ref(false);
const challengeToken = ref('');
const showResend = ref(false);
const resending = ref(false);

function redirectTarget(user: ClientUser): string {
  return safeRedirect(route.query.redirect, user);
}

function completeLogin(user: ClientUser, message: string): void {
  toast.ok(message);
  void router.replace(redirectTarget(user));
}

onMounted(() => {
  const current = auth.user;
  if (auth.isAuthenticated && current) {
    void router.replace(redirectTarget(current));
  }
});

async function onSubmit(): Promise<void> {
  if (!email.value.trim() || !password.value) {
    error.value = '请输入邮箱和密码';
    return;
  }
  loading.value = true;
  error.value = null;
  showResend.value = false;
  try {
    const response = await auth.login(email.value.trim(), password.value);
    if ('mfaRequired' in response) {
      challengeToken.value = response.challengeToken;
      return;
    }
    completeLogin(response.user, `欢迎回来，${response.user.name}`);
  } catch (err) {
    error.value = errorMessage(err);
    const code = errorCode(err);
    showResend.value = code === 'EMAIL_UNVERIFIED' || code === 'MAIL_FAILED';
  } finally {
    loading.value = false;
  }
}

function onMfaSuccess(user: ClientUser): void {
  completeLogin(user, '登录成功');
}

function backToCredentials(): void {
  challengeToken.value = '';
  error.value = null;
}

async function resendVerification(): Promise<void> {
  const target = email.value.trim();
  if (!target || resending.value) return;
  resending.value = true;
  try {
    const response = await authApi.resendVerification(target);
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

      <template v-if="challengeToken">
        <h1>两步验证</h1>
        <p class="auth-sub">请输入认证器中的 6 位验证码，或使用一枚恢复码。</p>
        <MfaChallengeForm
          :challenge-token="challengeToken"
          :email="email.trim()"
          @success="onMfaSuccess"
        />
        <p class="auth-alt">
          <button type="button" class="btn-link" @click="backToCredentials">返回登录</button>
        </p>
      </template>

      <template v-else>
        <h1>登录</h1>
        <p class="auth-sub">登录后可使用数据演示、账户设置与管理后台。</p>
        <form class="auth-form" @submit.prevent="onSubmit">
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
            autocomplete="current-password"
            placeholder="至少 8 个字符"
            :required="true"
          />
          <div v-if="error" class="form-error" role="alert">{{ error }}</div>
          <AppButton type="submit" variant="primary" block :loading="loading">登录</AppButton>
          <AppButton
            v-if="showResend"
            type="button"
            variant="ghost"
            block
            :loading="resending"
            @click="resendVerification"
          >
            重发验证邮件
          </AppButton>
        </form>
        <p class="auth-alt">
          还没有账号？<RouterLink to="/register">注册一个</RouterLink> ·
          <RouterLink to="/forgot">忘记密码？</RouterLink>
        </p>
      </template>
    </div>

    <aside class="auth-aside" aria-label="登录说明">
      <h2>普通用户</h2>
      <ul>
        <li>浏览课程、章节、知识中心与学习看板</li>
        <li>完成知识中心测验</li>
        <li>在账号页启用 MFA / 修改密码</li>
      </ul>
      <h2>管理员</h2>
      <ul>
        <li>用户管理：角色、启停、创建账号</li>
        <li>课程管理：课程信息、章节、视频</li>
        <li>编辑学习记录、导入/导出 CSV、恢复初始数据</li>
        <li>查看审计日志</li>
      </ul>
      <p class="muted">本网站展示的全部数据均为模拟数据，请勿输入真实姓名、账号或公司数据。</p>
    </aside>
  </section>
</template>