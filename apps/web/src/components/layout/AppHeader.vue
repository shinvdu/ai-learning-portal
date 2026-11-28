<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

type NavItem = { key: string; label: string; to: string };

const navItems: NavItem[] = [
  { key: 'home', label: '首页', to: '/' },
  { key: 'knowledge', label: '知识中心', to: '/knowledge' },
  { key: 'dashboard', label: '学习看板', to: '/dashboard' },
  { key: 'insights', label: '数据洞察', to: '/insights' },
];

const auth = useAuthStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

function isActive(item: NavItem): boolean {
  const path = route.path;
  switch (item.key) {
    case 'home':
      return path === '/' || path.startsWith('/courses');
    case 'knowledge':
      return path.startsWith('/knowledge');
    case 'dashboard':
      return path === '/dashboard';
    case 'insights':
      return path === '/insights';
    default:
      return path === item.to;
  }
}

const userLabel = computed(() => auth.user?.name || auth.user?.email || '我的账户');

async function onLogout(): Promise<void> {
  await auth.logout();
  toast.ok('已退出登录');
  if (route.path.startsWith('/admin') || route.path.startsWith('/account')) {
    await router.push('/');
  }
}
</script>

<template>
  <header class="site-header">
    <div class="bar">
      <RouterLink class="brand" to="/" aria-label="AI 学习门户首页">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="34" height="34" role="img" aria-label="门户标志">
            <polygon points="20,3 35,11.5 35,28.5 20,37 5,28.5 5,11.5" fill="#06C7CC" opacity="0.18" />
            <polygon
              points="20,6 32,13 32,27 20,34 8,27 8,13"
              fill="none"
              stroke="#06C7CC"
              stroke-width="2"
            />
            <path
              d="M13 27 20 12l7 15h-3.2l-1.2-2.7h-5.2L16.2 27H13zm5.2-5.2h3.6L20 16.4l-1.8 5.4z"
              fill="#fff"
            />
          </svg>
        </span>
        <span class="brand-text">
          <strong>AI 学习门户</strong>
          <small>LEARNING ANALYTICS</small>
        </span>
      </RouterLink>

      <nav class="main-nav" aria-label="主导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          :class="{ active: isActive(item) }"
          :aria-current="isActive(item) ? 'page' : undefined"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="header-tools">
        <div class="user-area">
          <template v-if="auth.user">
            <RouterLink v-if="auth.isAdmin" class="user-admin" to="/admin">管理后台</RouterLink>
            <RouterLink class="user-name" to="/account" :title="auth.user.email">
              {{ userLabel }}
            </RouterLink>
            <button type="button" class="btn btn-light btn-sm" @click="onLogout">退出</button>
          </template>
          <template v-else>
            <RouterLink class="user-link" to="/login">登录</RouterLink>
            <RouterLink class="btn btn-light btn-sm" to="/register">注册</RouterLink>
          </template>
        </div>
        <span class="sim-badge" title="本网站展示的全部数据均为模拟数据">模拟数据</span>
      </div>
    </div>
  </header>
</template>