<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { adminApi } from '@/api/endpoints';
import type { AdminCourse, AdminUser, AuditRow, UserRole } from '@/api/types';
import { errorMessage } from '@/api/client';
import AppButton from '@/components/ui/AppButton.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import AuditTable from '@/components/admin/AuditTable.vue';
import ChangePasswordDialog from '@/components/admin/ChangePasswordDialog.vue';
import CourseTable from '@/components/admin/CourseTable.vue';
import CreateUserDialog from '@/components/admin/CreateUserDialog.vue';
import DatasetSnapshots from '@/components/admin/DatasetSnapshots.vue';
import UserTable from '@/components/admin/UserTable.vue';
import { apiErrorList, conflictRecordCount } from '@/components/admin/apiErrors';
import { deleteAdminCourse } from '@/components/admin/adminCourseApi';
import { useConfirm } from '@/composables/useConfirm';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

const tabs: { id: string; label: string }[] = [
  { id: 'users', label: '用户管理' },
  { id: 'courses', label: '课程管理' },
  { id: 'snapshots', label: '数据快照' },
  { id: 'audit', label: '审计日志' },
];

const auth = useAuthStore();
const toast = useToastStore();
const confirm = useConfirm();

const activeTab = ref('users');
const users = ref<AdminUser[]>([]);
const courses = ref<AdminCourse[]>([]);
const audit = ref<AuditRow[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const busyIds = ref<number[]>([]);

const createOpen = ref(false);
const passwordOpen = ref(false);
const passwordTarget = ref<{ id: number; name: string } | null>(null);

async function loadAll(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [userData, courseData, auditData] = await Promise.all([
      adminApi.users.list(),
      adminApi.courses.list(),
      adminApi.audit.list({ limit: 30 }),
    ]);
    users.value = userData.users;
    courses.value = courseData.courses;
    audit.value = auditData.rows;
  } catch (thrown) {
    error.value = errorMessage(thrown);
  } finally {
    loading.value = false;
  }
}

async function loadUsers(): Promise<void> {
  try {
    users.value = (await adminApi.users.list()).users;
  } catch {
    /* keep the current table; the mutation toast already reported the failure */
  }
}

async function loadAudit(): Promise<void> {
  try {
    audit.value = (await adminApi.audit.list({ limit: 30 })).rows;
  } catch {
    /* audit is supplementary; a failed refresh must not break the page */
  }
}

onMounted(loadAll);

function replaceUser(updated: AdminUser): void {
  users.value = users.value.map((user) => (user.id === updated.id ? updated : user));
}

function markBusy(id: number): void {
  if (!busyIds.value.includes(id)) busyIds.value = [...busyIds.value, id];
}

function clearBusy(id: number): void {
  busyIds.value = busyIds.value.filter((value) => value !== id);
}

async function patchUser(
  user: AdminUser,
  patch: Parameters<typeof adminApi.users.update>[1],
  successMessage: string,
): Promise<AdminUser | null> {
  markBusy(user.id);
  try {
    const { user: updated } = await adminApi.users.update(user.id, patch);
    replaceUser(updated);
    toast.ok(successMessage);
    void loadAudit();
    return updated;
  } catch (thrown) {
    toast.error(apiErrorList(thrown).join('；'));
    await loadUsers();
    return null;
  } finally {
    clearBusy(user.id);
  }
}

function openCreateUser(): void {
  activeTab.value = 'users';
  createOpen.value = true;
}

function onUserCreated(user: AdminUser): void {
  if (users.value.some((existing) => existing.id === user.id)) replaceUser(user);
  else users.value = [...users.value, user];
  activeTab.value = 'users';
  void loadAudit();
}

function onRoleChange(user: AdminUser, role: UserRole): void {
  if (user.role === role) return;
  void patchUser(user, { role }, '角色已更新');
}

async function onToggleActive(user: AdminUser): Promise<void> {
  if (user.active) {
    const ok = await confirm({
      title: '停用用户',
      message: `停用「${user.name}」？该用户的所有会话会立即失效。`,
      confirmText: '停用',
      danger: true,
    });
    if (!ok) return;
  }
  await patchUser(user, { active: !user.active }, '用户状态已更新');
}

function openPassword(user: AdminUser): void {
  passwordTarget.value = { id: user.id, name: user.name };
  passwordOpen.value = true;
}

async function onVerify(user: AdminUser): Promise<void> {
  await patchUser(user, { emailVerified: true }, '邮箱已标记为已验证');
}

async function onUnlock(user: AdminUser): Promise<void> {
  await patchUser(user, { unlock: true }, '账号已解锁');
}

async function onResetMfa(user: AdminUser): Promise<void> {
  const ok = await confirm({
    title: '重置 MFA',
    message: `重置「${user.name}」的 MFA？对方需要重新绑定认证器。`,
    confirmText: '重置 MFA',
    danger: true,
  });
  if (!ok) return;
  await patchUser(user, { resetMfa: true }, 'MFA 已重置');
}

async function removeCourse(course: AdminCourse): Promise<void> {
  const first = await confirm({
    title: '删除课程',
    message: `确定删除课程「${course.name}」？`,
    confirmText: '删除',
    danger: true,
  });
  if (!first) return;

  try {
    const result = await deleteAdminCourse(course.id);
    finishDelete(course, result.deletedRecords);
  } catch (thrown) {
    const records = conflictRecordCount(thrown);
    if (records === null) {
      toast.error(apiErrorList(thrown).join('；'));
      return;
    }

    const force = await confirm({
      title: '课程仍有学习记录',
      message:
        `该课程还有 ${records} 条学习记录。\n` +
        '继续删除会同时删除这些学习记录、章节与知识文档，且无法撤销。确定吗？',
      confirmText: '同时删除记录',
      danger: true,
    });
    if (!force) return;

    try {
      const result = await deleteAdminCourse(course.id, true);
      finishDelete(course, result.deletedRecords);
    } catch (secondError) {
      toast.error(apiErrorList(secondError).join('；'));
    }
  }
}

function finishDelete(course: AdminCourse, deletedRecords: number): void {
  courses.value = courses.value.filter((item) => item.id !== course.id);
  toast.ok(
    deletedRecords > 0
      ? `课程及其 ${deletedRecords} 条学习记录已删除`
      : '课程已删除',
  );
  void loadAudit();
}
</script>

<template>
  <header class="page-head">
    <div>
      <span class="eyebrow">ADMIN · 管理后台</span>
      <h1>用户与课程管理</h1>
      <p>
        管理员可以创建用户、调整角色与状态，并维护课程元数据、章节与视频。仅管理员可见，
        学习者访问会被路由与 API 双重拦截。
      </p>
    </div>
    <div class="page-actions">
      <AppButton @click="openCreateUser">＋ 新增用户</AppButton>
      <AppButton variant="ghost" to="/admin/courses/new">＋ 新建课程</AppButton>
    </div>
  </header>

  <LoadingBlock v-if="loading" text="正在加载管理数据…" />
  <ErrorCard v-else-if="error" :message="error" @retry="loadAll" />
  <template v-else>
    <div class="admin-tabs">
      <AppTabs v-model="activeTab" :tabs="tabs" label="管理后台分区" />
    </div>

    <UserTable
      v-if="activeTab === 'users'"
      :users="users"
      :current-user-id="auth.user?.id ?? null"
      :busy-ids="busyIds"
      @role="onRoleChange"
      @toggle-active="onToggleActive"
      @password="openPassword"
      @verify="onVerify"
      @unlock="onUnlock"
      @reset-mfa="onResetMfa"
    />

    <CourseTable v-else-if="activeTab === 'courses'" :courses="courses" @remove="removeCourse" />

    <DatasetSnapshots v-else-if="activeTab === 'snapshots'" @restored="loadAudit" />

    <AuditTable v-else :rows="audit" />

    <p class="footnote">本页面操作的是模拟数据；所有管理操作都会写入审计日志。</p>
  </template>

  <CreateUserDialog v-model:open="createOpen" @created="onUserCreated" />
  <ChangePasswordDialog
    v-model:open="passwordOpen"
    :user-id="passwordTarget?.id ?? null"
    :user-name="passwordTarget?.name ?? ''"
  />
</template>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.admin-tabs {
  margin-bottom: 4px;
}
</style>