<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppButton from '@/components/ui/AppButton.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import AccountStatusPanel from '@/components/account/AccountStatusPanel.vue';
import ChangePasswordForm from '@/components/account/ChangePasswordForm.vue';
import MfaSetupPanel from '@/components/account/MfaSetupPanel.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

const user = computed(() => auth.user);
const refreshing = ref(true);

const roleLabel = computed(() => (user.value?.role === 'admin' ? '管理员' : '学员'));

onMounted(async () => {
  // Re-read `/auth/me` so verification/MFA changes made elsewhere are current.
  await auth.refresh();
  refreshing.value = false;
});

async function onMfaChanged(enabled: boolean): Promise<void> {
  // Optimistically reflect the new state, then confirm against `/auth/me`.
  if (user.value) auth.setUser({ ...user.value, mfaEnabled: enabled });
  await auth.refresh();
}
</script>

<template>
  <header class="page-head">
    <div>
      <span class="eyebrow">ACCOUNT · 账号设置</span>
      <h1>{{ user?.name ?? '账户与安全' }}</h1>
      <p v-if="user">{{ user.email }} · {{ roleLabel }}</p>
      <p v-else>登录后可修改密码、启用 MFA 与查看账号状态。</p>
    </div>
    <div class="page-actions">
      <AppButton v-if="auth.isAdmin" variant="ghost" size="sm" to="/admin">管理后台</AppButton>
      <AppButton variant="ghost" size="sm" to="/">返回首页</AppButton>
    </div>
  </header>

  <LoadingBlock v-if="refreshing" text="正在加载账户信息…" />

  <div v-else-if="!user" class="panel auth-gate">
    <span class="eyebrow">ACCOUNT</span>
    <h1>请先登录</h1>
    <p>登录后可修改密码、启用 MFA 与查看账号状态。</p>
    <AppButton variant="primary" to="/login">去登录</AppButton>
  </div>

  <div v-else class="account-grid">
    <AccountStatusPanel :user="user" />
    <ChangePasswordForm />
    <MfaSetupPanel :enabled="user.mfaEnabled" @changed="onMfaChanged" />
  </div>
</template>

<style scoped>
.page-actions {
  display: flex;
  gap: 9px;
  flex-wrap: wrap;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 18px;
  align-items: start;
}

@media (max-width: 900px) {
  .account-grid {
    grid-template-columns: 1fr;
  }
}
</style>