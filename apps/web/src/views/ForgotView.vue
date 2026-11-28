<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';

const email = ref('');
const error = ref<string | null>(null);
const loading = ref(false);
const sentMessage = ref('');

async function onSubmit(): Promise<void> {
  const target = email.value.trim();
  if (!target) {
    error.value = '请输入注册邮箱';
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const response = await authApi.forgotPassword(target);
    sentMessage.value = response.message || '如果邮箱存在，重置邮件将很快送达';
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

      <template v-if="sentMessage">
        <h1>邮件已发送</h1>
        <p class="auth-sub">{{ sentMessage }}</p>
        <div class="form-actions">
          <AppButton variant="primary" to="/login">返回登录</AppButton>
        </div>
      </template>

      <template v-else>
        <h1>忘记密码</h1>
        <p class="auth-sub">输入注册邮箱，我们会发送一封重置密码邮件（1 小时内有效）。</p>
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
          <div v-if="error" class="form-error" role="alert">{{ error }}</div>
          <AppButton type="submit" variant="primary" block :loading="loading">
            发送重置邮件
          </AppButton>
        </form>
        <p class="auth-alt"><RouterLink to="/login">返回登录</RouterLink></p>
      </template>
    </div>

    <aside class="auth-aside" aria-label="找回密码说明">
      <h2>说明</h2>
      <ul>
        <li>为避免泄露账号信息，无论邮箱是否存在都会返回相同提示。</li>
        <li>邮件中的链接只能使用一次。</li>
        <li>开发环境未配置邮件网关时，链接会打印在服务端控制台。</li>
      </ul>
    </aside>
  </section>
</template>