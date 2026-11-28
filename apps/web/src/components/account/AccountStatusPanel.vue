<script setup lang="ts">
/** Read-only account status plus the resend-verification action (F081). */
import { ref } from 'vue';
import AppButton from '@/components/ui/AppButton.vue';
import StatusPill from '@/components/ui/StatusPill.vue';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { useToastStore } from '@/stores/toast';
import type { ClientUser } from '@/api/types';

const props = defineProps<{ user: ClientUser }>();

const toast = useToastStore();
const resending = ref(false);

async function resend(): Promise<void> {
  if (resending.value) return;
  resending.value = true;
  try {
    const response = await authApi.resendVerification(props.user.email);
    toast.ok(response.message || '如果邮箱存在，验证邮件将很快送达');
  } catch (err) {
    toast.error(errorMessage(err));
  } finally {
    resending.value = false;
  }
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>账号状态</h2>
        <p class="panel-sub">邮箱验证与登录保护。</p>
      </div>
    </div>

    <dl class="kv">
      <div>
        <dt>邮箱</dt>
        <dd class="kv-email">{{ user.email }}</dd>
      </div>
      <div>
        <dt>邮箱验证</dt>
        <dd>
          <StatusPill :tone="user.emailVerified ? 'ok' : 'off'">
            {{ user.emailVerified ? '已验证' : '未验证' }}
          </StatusPill>
        </dd>
      </div>
      <div>
        <dt>两步验证 MFA</dt>
        <dd>
          <StatusPill :tone="user.mfaEnabled ? 'ok' : 'off'">
            {{ user.mfaEnabled ? '已启用' : '未启用' }}
          </StatusPill>
        </dd>
      </div>
      <div>
        <dt>角色</dt>
        <dd>{{ user.role === 'admin' ? '管理员' : '学员' }}</dd>
      </div>
    </dl>

    <div v-if="!user.emailVerified" class="form-actions">
      <AppButton variant="ghost" size="sm" :loading="resending" @click="resend">
        重发验证邮件
      </AppButton>
      <span class="hint-inline">验证邮件 24 小时内有效</span>
    </div>
  </section>
</template>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin: 12px 0 0;
}

.kv > div {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  background: #fcfdff;
}

.kv dt {
  color: var(--muted);
  font-size: 12px;
}

.kv dd {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--ink);
}

.kv-email {
  word-break: break-all;
}

.hint-inline {
  color: var(--muted);
  font-size: 12.5px;
  align-self: center;
}

@media (max-width: 720px) {
  .kv {
    grid-template-columns: 1fr;
  }
}
</style>