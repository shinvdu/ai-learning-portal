<script setup lang="ts">
import { computed } from 'vue';
import type { AdminUser, UserRole } from '@/api/types';
import { fmtTime } from '@/utils/format';

const props = defineProps<{
  users: AdminUser[];
  /** Signed-in admin; role/enable controls on this row are read-only. */
  currentUserId: number | null;
  /** Ids with an in-flight mutation; their controls are disabled. */
  busyIds: number[];
}>();

const emit = defineEmits<{
  role: [user: AdminUser, role: UserRole];
  toggleActive: [user: AdminUser];
  password: [user: AdminUser];
  verify: [user: AdminUser];
  unlock: [user: AdminUser];
  resetMfa: [user: AdminUser];
}>();

const adminCount = computed(() => props.users.filter((user) => user.role === 'admin').length);

function isSelf(user: AdminUser): boolean {
  return user.id === props.currentUserId;
}

function isBusy(user: AdminUser): boolean {
  return props.busyIds.includes(user.id);
}

function controlsDisabled(user: AdminUser): boolean {
  return isSelf(user) || isBusy(user);
}

function isLocked(user: AdminUser): boolean {
  return user.locked_until !== null && user.locked_until > Date.now();
}

function onRoleChange(user: AdminUser, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  emit('role', user, value === 'admin' ? 'admin' : 'learner');
}
</script>

<template>
  <section class="panel" aria-labelledby="admin-users-title">
    <div class="panel-head">
      <div>
        <h2 id="admin-users-title">用户</h2>
        <p class="panel-sub">
          共 {{ users.length }} 个账号；停用用户会立即失效其会话。自己的角色与启停控件已禁用。
        </p>
      </div>
      <span class="tag">{{ adminCount }} 个管理员</span>
    </div>

    <div class="table-wrap">
      <table class="data-table" aria-describedby="admin-users-title">
        <caption class="sr-only">后台用户列表：姓名、邮箱、角色、状态与操作</caption>
        <thead>
          <tr>
            <th scope="col">用户</th>
            <th scope="col">角色</th>
            <th scope="col">状态</th>
            <th scope="col">最近登录</th>
            <th scope="col">创建时间</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" :aria-busy="isBusy(user) || undefined">
            <td>
              <strong>{{ user.name }}</strong>
              <span v-if="isSelf(user)" class="tag tag-plain self-tag">当前账号</span>
              <div class="muted">{{ user.email }}</div>
              <div class="user-flags">
                <span class="status-pill" :class="user.email_verified ? 'ok' : 'off'">
                  {{ user.email_verified ? '已验证' : '未验证' }}
                </span>
                <span v-if="user.mfa_enabled" class="status-pill info">MFA</span>
                <span v-if="isLocked(user)" class="status-pill warn">锁定</span>
              </div>
            </td>
            <td>
              <select
                :value="user.role"
                :disabled="controlsDisabled(user)"
                :aria-label="isSelf(user) ? `用户角色（当前账号不可修改）：${user.name}` : `用户角色：${user.name}`"
                @change="onRoleChange(user, $event)"
              >
                <option value="learner">学员</option>
                <option value="admin">管理员</option>
              </select>
            </td>
            <td>
              <span class="status-pill" :class="user.active ? 'ok' : 'off'">
                {{ user.active ? '启用' : '停用' }}
              </span>
              <button
                type="button"
                class="btn-link"
                :class="user.active ? 'danger-text' : ''"
                :disabled="controlsDisabled(user)"
                :aria-label="`${user.active ? '停用' : '启用'}用户：${user.name}`"
                @click="emit('toggleActive', user)"
              >
                {{ isBusy(user) ? '处理中…' : user.active ? '停用' : '启用' }}
              </button>
            </td>
            <td class="muted">{{ fmtTime(user.last_login_at) }}</td>
            <td class="muted">{{ fmtTime(user.created_at) }}</td>
            <td class="actions">
              <button type="button" class="btn-link" :disabled="isBusy(user)" @click="emit('password', user)">
                改密码
              </button>
              <button
                v-if="!user.email_verified"
                type="button"
                class="btn-link"
                :disabled="isBusy(user)"
                @click="emit('verify', user)"
              >
                标记已验证
              </button>
              <button
                v-if="user.mfa_enabled"
                type="button"
                class="btn-link danger-text"
                :disabled="isBusy(user)"
                @click="emit('resetMfa', user)"
              >
                重置 MFA
              </button>
              <button
                v-if="isLocked(user)"
                type="button"
                class="btn-link"
                :disabled="isBusy(user)"
                @click="emit('unlock', user)"
              >
                解锁
              </button>
            </td>
          </tr>
          <tr v-if="users.length === 0">
            <td colspan="6" class="muted">暂无用户。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.self-tag {
  margin-left: 8px;
  font-size: 11px;
}

.user-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.actions {
  white-space: nowrap;
}

.actions .btn-link {
  padding: 2px 6px;
}

td select {
  min-width: 96px;
}
</style>