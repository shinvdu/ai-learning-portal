<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { adminApi } from '@/api/endpoints';
import AppButton from '@/components/ui/AppButton.vue';
import AppDialog from '@/components/ui/AppDialog.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { useToastStore } from '@/stores/toast';
import { apiErrorList } from './apiErrors';

const props = defineProps<{
  open: boolean;
  userId: number | null;
  userName: string;
}>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const toast = useToastStore();
const password = ref('');
const busy = ref(false);
const fieldError = ref('');
const serverErrors = ref<string[]>([]);

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const title = computed(() =>
  props.userName ? `修改密码 · ${props.userName}` : '修改密码',
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    password.value = '';
    fieldError.value = '';
    serverErrors.value = [];
  },
);

async function submit(): Promise<void> {
  serverErrors.value = [];
  fieldError.value = '';

  if (props.userId === null) {
    serverErrors.value = ['请选择要修改的用户'];
    return;
  }
  if (password.value.length < 8) {
    fieldError.value = '密码至少需要 8 个字符';
    return;
  }

  busy.value = true;
  try {
    await adminApi.users.update(props.userId, { password: password.value });
    toast.ok('密码已更新');
    openModel.value = false;
  } catch (error) {
    serverErrors.value = apiErrorList(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog v-model:open="openModel" :title="title">
    <form novalidate @submit.prevent="submit">
      <AppInput
        v-model="password"
        label="新密码"
        type="password"
        required
        :minlength="8"
        :maxlength="200"
        autocomplete="new-password"
        hint="至少 8 个字符；保存后该用户的其它会话会被撤销。"
        :disabled="busy"
        :error="fieldError"
      />

      <div v-if="serverErrors.length > 0" class="form-error" role="alert">
        <ul class="error-list">
          <li v-for="message in serverErrors" :key="message">{{ message }}</li>
        </ul>
      </div>

      <div class="dialog-foot">
        <AppButton variant="ghost" :disabled="busy" @click="openModel = false">取消</AppButton>
        <AppButton type="submit" :loading="busy">更新密码</AppButton>
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