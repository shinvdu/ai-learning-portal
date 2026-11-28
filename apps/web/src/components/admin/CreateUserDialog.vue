<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { adminApi } from '@/api/endpoints';
import type { AdminUser, UserRole } from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';
import AppDialog from '@/components/ui/AppDialog.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { useToastStore } from '@/stores/toast';
import { apiErrorList } from './apiErrors';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [user: AdminUser] }>();

const toast = useToastStore();
const busy = ref(false);
const serverErrors = ref<string[]>([]);
const fieldErrors = reactive<{ name?: string; email?: string; password?: string }>({});

const form = reactive({
  name: '',
  email: '',
  password: '',
  role: 'learner' as UserRole,
});

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    form.name = '';
    form.email = '';
    form.password = '';
    form.role = 'learner';
    serverErrors.value = [];
    fieldErrors.name = undefined;
    fieldErrors.email = undefined;
    fieldErrors.password = undefined;
  },
);

function validate(): boolean {
  fieldErrors.name = undefined;
  fieldErrors.email = undefined;
  fieldErrors.password = undefined;

  const name = form.name.trim();
  if (name.length < 1 || name.length > 60) fieldErrors.name = '姓名需要 1–60 个字符';

  const email = form.email.trim();
  if (!email) fieldErrors.email = '请填写邮箱';
  else if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = '邮箱格式不正确';
  }

  if (form.password.length < 8) fieldErrors.password = '密码至少需要 8 个字符';
  else if (form.password.length > 200) fieldErrors.password = '密码过长';

  return !fieldErrors.name && !fieldErrors.email && !fieldErrors.password;
}

async function submit(): Promise<void> {
  serverErrors.value = [];
  if (!validate()) return;

  busy.value = true;
  try {
    const { user } = await adminApi.users.create({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
    });
    toast.ok('用户已创建');
    emit('created', user);
    openModel.value = false;
  } catch (error) {
    serverErrors.value = apiErrorList(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog v-model:open="openModel" title="新增用户">
    <form novalidate @submit.prevent="submit">
      <div class="form-grid">
        <AppInput
          v-model="form.name"
          label="姓名"
          name="name"
          required
          :maxlength="60"
          autocomplete="off"
          :disabled="busy"
          :error="fieldErrors.name"
        />
        <AppInput
          v-model="form.email"
          label="邮箱"
          type="email"
          name="email"
          required
          :maxlength="160"
          autocomplete="off"
          :disabled="busy"
          :error="fieldErrors.email"
        />
        <AppInput
          v-model="form.password"
          label="初始密码"
          type="password"
          name="password"
          required
          :minlength="8"
          :maxlength="200"
          autocomplete="new-password"
          hint="至少 8 个字符，建议至少 12 个字符。"
          :disabled="busy"
          :error="fieldErrors.password"
        />
        <label class="field">
          <span class="field-label">角色</span>
          <select v-model="form.role" name="role" :disabled="busy">
            <option value="learner">学员</option>
            <option value="admin">管理员</option>
          </select>
        </label>
      </div>

      <div v-if="serverErrors.length > 0" class="form-error" role="alert">
        <ul class="error-list">
          <li v-for="message in serverErrors" :key="message">{{ message }}</li>
        </ul>
      </div>

      <div class="dialog-foot">
        <AppButton variant="ghost" :disabled="busy" @click="openModel = false">取消</AppButton>
        <AppButton type="submit" :loading="busy">创建用户</AppButton>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.error-list {
  margin: 0;
  padding-left: 18px;
}
</style>