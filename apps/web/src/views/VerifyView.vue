<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import AppButton from '@/components/ui/AppButton.vue';
import MfaChallengeForm from '@/components/account/MfaChallengeForm.vue';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { ClientUser } from '@/api/types';

const route = useRoute();
const auth = useAuthStore();
const toast = useToastStore();

const token = computed(() => {
  const raw = route.query.token;
  return typeof raw === 'string' ? raw : '';
});

const verifying = ref(false);
const failedMessage = ref('');
const challengeToken = ref('');
const doneUser = ref<ClientUser | null>(null);

const portalPath = computed(() => (doneUser.value?.role === 'admin' ? '/admin' : '/'));

async function confirmVerify(): Promise<void> {
  if (verifying.value) return;
  verifying.value = true;
  failedMessage.value = '';
  try {
    const response = await authApi.verifyEmail(token.value);
    if (response.mfaRequired && response.challengeToken) {
      // No session cookie is issued until the MFA challenge is redeemed, so
      // keep the store unauthenticated until `verifyMfa` succeeds.
      challengeToken.value = response.challengeToken;
      return;
    }
    auth.setUser(response.user);
    doneUser.value = response.user;
    toast.ok('邮箱验证成功');
  } catch (err) {
    failedMessage.value = errorMessage(err);
  } finally {
    verifying.value = false;
  }
}

function onMfaSuccess(user: ClientUser): void {
  challengeToken.value = '';
  doneUser.value = user;
  toast.ok('登录成功');
}
</script>

<template>
  <template v-if="!token">
    <div class="panel auth-gate">
      <span class="eyebrow">EMAIL VERIFICATION</span>
      <h1>验证链接无效</h1>
      <p>链接缺少 token，请从邮件中重新打开。</p>
      <AppButton variant="primary" to="/login">返回登录</AppButton>
    </div>
  </template>

  <section v-else-if="challengeToken" class="auth-page">
    <div class="panel auth-card">
      <span class="eyebrow">EMAIL VERIFICATION</span>
      <h1>两步验证</h1>
      <p class="auth-sub">邮箱已验证，请输入认证器中的 6 位验证码，或使用一枚恢复码完成登录。</p>
      <MfaChallengeForm :challenge-token="challengeToken" @success="onMfaSuccess" />
      <p class="auth-alt"><RouterLink to="/login">返回登录</RouterLink></p>
    </div>
    <aside class="auth-aside" aria-label="邮箱验证说明">
      <h2>账号保护</h2>
      <p class="muted">验证码每 30 秒更新一次。恢复码只能使用一次，请妥善保存。</p>
    </aside>
  </section>

  <div v-else-if="doneUser" class="panel auth-gate">
    <span class="eyebrow">EMAIL VERIFIED</span>
    <h1>邮箱验证成功</h1>
    <p>{{ doneUser.email }} 已通过验证，并已自动登录。</p>
    <div class="form-actions">
      <AppButton variant="primary" :to="portalPath">进入门户</AppButton>
      <AppButton variant="ghost" to="/account">账号设置</AppButton>
    </div>
  </div>

  <div v-else-if="failedMessage" class="panel auth-gate">
    <span class="eyebrow">EMAIL VERIFICATION</span>
    <h1>验证失败</h1>
    <p role="alert">{{ failedMessage }}</p>
    <div class="form-actions">
      <AppButton variant="primary" to="/login">返回登录</AppButton>
    </div>
    <p class="auth-alt">如验证链接已过期，请在登录页触发“重发验证邮件”。</p>
  </div>

  <div v-else class="panel auth-gate">
    <span class="eyebrow">EMAIL VERIFICATION</span>
    <h1>确认验证邮箱</h1>
    <p>点击下方按钮完成验证并登录。链接 24 小时内有效。</p>
    <AppButton variant="primary" :loading="verifying" @click="confirmVerify">
      确认验证邮箱
    </AppButton>
    <p class="auth-alt"><RouterLink to="/login">返回登录</RouterLink></p>
  </div>
</template>