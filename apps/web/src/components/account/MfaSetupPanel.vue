<script setup lang="ts">
/**
 * MFA self-service (F081): start setup → show secret + otpauth URI → enable with
 * a TOTP code → reveal 8 recovery codes exactly once. When enabled, disabling
 * requires the account password.
 */
import { ref } from 'vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import StatusPill from '@/components/ui/StatusPill.vue';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { useToastStore } from '@/stores/toast';
import type { MfaSetupResponse } from '@/api/types';

const props = defineProps<{ enabled: boolean }>();
const emit = defineEmits<{ changed: [enabled: boolean] }>();

const toast = useToastStore();

const setup = ref<MfaSetupResponse | null>(null);
const recoveryCodes = ref<string[] | null>(null);
const enabling = ref(false);
const starting = ref(false);
const disabling = ref(false);
const enableError = ref<string | null>(null);
const disableError = ref<string | null>(null);
const code = ref('');
const disablePassword = ref('');

async function copyText(text: string, label: string): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('clipboard unavailable');
    }
    await navigator.clipboard.writeText(text);
    toast.ok(`${label}已复制`);
  } catch {
    toast.error('复制失败，请手动选择文本复制');
  }
}

async function startSetup(): Promise<void> {
  if (starting.value) return;
  starting.value = true;
  enableError.value = null;
  try {
    setup.value = await authApi.mfaSetup();
    toast.info('请在认证器中添加密钥');
  } catch (err) {
    toast.error(errorMessage(err));
  } finally {
    starting.value = false;
  }
}

async function enable(): Promise<void> {
  const value = code.value.trim();
  if (!value) {
    enableError.value = '请输入认证器中的 6 位验证码';
    return;
  }
  enabling.value = true;
  enableError.value = null;
  try {
    const response = await authApi.mfaEnable(value);
    recoveryCodes.value = response.recoveryCodes;
    code.value = '';
  } catch (err) {
    enableError.value = errorMessage(err);
  } finally {
    enabling.value = false;
  }
}

function finish(): void {
  recoveryCodes.value = null;
  setup.value = null;
  toast.ok('MFA 已启用');
  emit('changed', true);
}

async function disable(): Promise<void> {
  if (!disablePassword.value) {
    disableError.value = '请输入密码';
    return;
  }
  disabling.value = true;
  disableError.value = null;
  try {
    await authApi.mfaDisable(disablePassword.value);
    disablePassword.value = '';
    toast.ok('MFA 已停用');
    emit('changed', false);
  } catch (err) {
    disableError.value = errorMessage(err);
  } finally {
    disabling.value = false;
  }
}

const recoveryText = (): string => (recoveryCodes.value ?? []).join('\n');
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>两步验证 MFA</h2>
        <p class="panel-sub">使用 TOTP 认证器（Google Authenticator、1Password 等）。</p>
      </div>
      <StatusPill v-if="props.enabled || recoveryCodes" tone="ok">已启用</StatusPill>
    </div>

    <!-- Recovery codes are shown exactly once, right after enabling. -->
    <div v-if="recoveryCodes" class="recovery-box">
      <h3>恢复码（只显示一次）</h3>
      <p class="warning">
        请立即妥善保存这些恢复码，每个只能使用一次。离开本页后将无法再次查看。
      </p>
      <div class="recovery-grid">
        <code v-for="item in recoveryCodes" :key="item">{{ item }}</code>
      </div>
      <div class="form-actions">
        <AppButton variant="ghost" size="sm" @click="copyText(recoveryText(), '恢复码')">
          复制全部恢复码
        </AppButton>
        <AppButton variant="primary" size="sm" @click="finish">我已保存，完成</AppButton>
      </div>
    </div>

    <!-- Enabled: require the password to turn MFA off. -->
    <form v-else-if="props.enabled" class="auth-form" @submit.prevent="disable">
      <p class="panel-sub">停用后，登录将只需密码，账号安全性会降低。</p>
      <AppInput
        v-model="disablePassword"
        label="密码"
        name="password"
        type="password"
        autocomplete="current-password"
        :required="true"
      />
      <div v-if="disableError" class="form-error" role="alert">{{ disableError }}</div>
      <AppButton type="submit" variant="danger" :loading="disabling">停用 MFA</AppButton>
    </form>

    <!-- Setup in progress: show the secret and one-time URI as copyable text. -->
    <div v-else-if="setup" class="setup-area">
      <p class="panel-sub">
        在认证器中添加以下密钥，或手动输入一次性 URI，然后输入 6 位验证码完成启用。
      </p>
      <div class="secret-row">
        <span class="secret-label">密钥</span>
        <code class="secret-block">{{ setup.secret }}</code>
        <AppButton variant="ghost" size="sm" @click="copyText(setup.secret, '密钥')">
          复制
        </AppButton>
      </div>
      <div class="secret-row">
        <span class="secret-label">URI</span>
        <code class="secret-block uri">{{ setup.otpauthUri }}</code>
        <AppButton variant="ghost" size="sm" @click="copyText(setup.otpauthUri, 'URI')">
          复制
        </AppButton>
      </div>

      <form class="auth-form" @submit.prevent="enable">
        <AppInput
          v-model="code"
          label="认证器 6 位验证码"
          name="mfaCode"
          placeholder="123456"
          autocomplete="one-time-code"
          inputmode="numeric"
          :maxlength="6"
          :required="true"
          :error="enableError ?? undefined"
        />
        <AppButton type="submit" variant="primary" :loading="enabling">启用 MFA</AppButton>
      </form>
    </div>

    <!-- Not enabled and no setup yet. -->
    <div v-else>
      <p class="panel-sub">启用后，登录需要额外输入认证器动态验证码。</p>
      <AppButton variant="primary" :loading="starting" @click="startSetup">
        开始设置 MFA
      </AppButton>
    </div>
  </section>
</template>

<style scoped>
.setup-area {
  margin-top: 4px;
}

.secret-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.secret-label {
  color: var(--muted);
  font-size: 12.5px;
  min-width: 36px;
}

.secret-block {
  flex: 1 1 240px;
  min-width: 0;
  background: #0b1030;
  color: #dbe4ff;
  border-radius: var(--radius-xs);
  padding: 9px 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.secret-block.uri {
  color: #b8f4f6;
}

.recovery-box {
  margin-top: 10px;
  background: #fffbf0;
  border: 1px solid #f0d6ac;
  border-radius: var(--radius-sm);
  padding: 16px;
}

.recovery-box h3 {
  margin-bottom: 6px;
}

.warning {
  color: #8a4b16;
  font-size: 13px;
  margin-bottom: 12px;
}

.recovery-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.recovery-grid code {
  background: #fff;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-xs);
  padding: 7px 4px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.5px;
}

@media (max-width: 720px) {
  .recovery-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>