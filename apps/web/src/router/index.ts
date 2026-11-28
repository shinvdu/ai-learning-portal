/**
 * History-mode router (F070).
 *
 * - Old v1 hash links (`#/home`, `#/course/C3`, `#/admin/course/C3`, ...) are
 *   rewritten to the canonical paths, preserving their query string.
 * - `beforeEach` awaits the auth store, gates `/account` and `/admin`, and sets
 *   `document.title` from route meta.
 * - `afterEach` moves focus/scroll to `main#main` on client navigations.
 */
import { createRouter, createWebHistory, type RouteLocationRaw, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

import HomeView from '@/views/HomeView.vue';
import CourseView from '@/views/CourseView.vue';
import ChapterView from '@/views/ChapterView.vue';
import KnowledgeView from '@/views/KnowledgeView.vue';
import DashboardView from '@/views/DashboardView.vue';
import InsightsView from '@/views/InsightsView.vue';
import LoginView from '@/views/LoginView.vue';
import RegisterView from '@/views/RegisterView.vue';
import ForgotView from '@/views/ForgotView.vue';
import ResetView from '@/views/ResetView.vue';
import VerifyView from '@/views/VerifyView.vue';
import AccountView from '@/views/AccountView.vue';
import NotFoundView from '@/views/NotFoundView.vue';
import AdminHomeView from '@/views/admin/AdminHomeView.vue';
import AdminCourseView from '@/views/admin/AdminCourseView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    nav?: 'home' | 'knowledge' | 'dashboard' | 'insights' | 'admin';
    requiresAuth?: boolean;
    requiresAdmin?: boolean;
  }
}

export const SITE_TITLE = 'AI 学习与数据分析门户';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '课程广场', nav: 'home' } },
  {
    path: '/courses/:id',
    name: 'course',
    component: CourseView,
    meta: { title: '课程详情', nav: 'home' },
  },
  {
    path: '/courses/:courseId/chapters/:idx',
    name: 'chapter',
    component: ChapterView,
    meta: { title: '章节学习', nav: 'home' },
  },
  {
    path: '/knowledge/:id?',
    name: 'knowledge',
    component: KnowledgeView,
    meta: { title: '知识中心', nav: 'knowledge' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: DashboardView,
    meta: { title: '学习看板', nav: 'dashboard' },
  },
  {
    path: '/insights',
    name: 'insights',
    component: InsightsView,
    meta: { title: '数据洞察', nav: 'insights' },
  },
  { path: '/login', name: 'login', component: LoginView, meta: { title: '登录' } },
  { path: '/register', name: 'register', component: RegisterView, meta: { title: '创建账号' } },
  { path: '/forgot', name: 'forgot', component: ForgotView, meta: { title: '找回密码' } },
  { path: '/reset', name: 'reset', component: ResetView, meta: { title: '重置密码' } },
  { path: '/verify', name: 'verify', component: VerifyView, meta: { title: '验证邮箱' } },
  {
    path: '/account',
    name: 'account',
    component: AccountView,
    meta: { title: '账户与安全', requiresAuth: true },
  },
  {
    path: '/admin',
    name: 'admin',
    component: AdminHomeView,
    meta: { title: '管理后台', nav: 'admin', requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/admin/courses/:id',
    name: 'admin-course',
    component: AdminCourseView,
    meta: { title: '课程编辑器', nav: 'admin', requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundView,
    meta: { title: '页面不存在' },
  },
];

/* ----------------------------- legacy hash links ---------------------------- */

type LegacyLocation = { path: string; query: Record<string, string> };

const ID = '([A-Za-z0-9_-]+)';

function decodeParam(value: string | undefined): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function queryFrom(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  new URLSearchParams(search).forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

/** Map a `#/...` fragment to its canonical path; `null` when it is not legacy. */
export function legacyLocation(hash: string): LegacyLocation | null {
  if (!hash.startsWith('#/')) return null;

  const raw = hash.slice(1);
  const queryIndex = raw.indexOf('?');
  const rawPath = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const query = queryFrom(queryIndex === -1 ? '' : raw.slice(queryIndex + 1));
  const path = rawPath || '/';
  let mapped: string | null = null;
  let match: RegExpMatchArray | null;

  if (/^\/home\/?$/.test(path)) {
    mapped = '/';
  } else if ((match = path.match(new RegExp(`^/course/${ID}/?$`)))) {
    mapped = `/courses/${decodeParam(match[1])}`;
  } else if ((match = path.match(new RegExp(`^/chapter/${ID}/(\\d+)/?$`)))) {
    mapped = `/courses/${decodeParam(match[1])}/chapters/${match[2] ?? ''}`;
  } else if ((match = path.match(new RegExp(`^/knowledge(?:/${ID})?/?$`)))) {
    mapped = match[1] ? `/knowledge/${decodeParam(match[1])}` : '/knowledge';
  } else if (/^\/dashboard\/?$/.test(path)) {
    mapped = '/dashboard';
  } else if (/^\/insights\/?$/.test(path)) {
    mapped = '/insights';
  } else if (/^\/login\/?$/.test(path)) {
    mapped = '/login';
  } else if (/^\/register\/?$/.test(path)) {
    mapped = '/register';
  } else if (/^\/forgot\/?$/.test(path)) {
    mapped = '/forgot';
  } else if (/^\/reset\/?$/.test(path)) {
    mapped = '/reset';
  } else if (/^\/verify\/?$/.test(path)) {
    mapped = '/verify';
  } else if (/^\/account\/?$/.test(path)) {
    mapped = '/account';
  } else if ((match = path.match(new RegExp(`^/admin/course/${ID}/?$`)))) {
    mapped = `/admin/courses/${decodeParam(match[1])}`;
  } else if (/^\/admin\/?$/.test(path)) {
    mapped = '/admin';
  } else {
    // Unknown legacy path: strip the hash and let the catch-all render 404.
    mapped = path;
  }

  return { path: mapped, query };
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 };
  },
});

router.beforeEach(async (to): Promise<RouteLocationRaw | boolean> => {
  if (to.hash.startsWith('#/')) {
    const legacy = legacyLocation(to.hash);
    if (legacy) {
      return { path: legacy.path, query: legacy.query, hash: '', replace: true };
    }
  }

  const auth = useAuthStore();
  await auth.ensureLoaded();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath }, replace: true };
  }

  if (to.meta.requiresAdmin) {
    if (!auth.isAuthenticated) {
      return { path: '/login', query: { redirect: to.fullPath }, replace: true };
    }
    if (!auth.isAdmin) {
      useToastStore().warn('需要管理员权限');
      return { path: '/', replace: true };
    }
  }

  if (typeof document !== 'undefined') {
    document.title = to.meta.title ? `${to.meta.title} · ${SITE_TITLE}` : SITE_TITLE;
  }

  return true;
});

router.afterEach((_to, from) => {
  if (typeof document === 'undefined') return;
  // Do not steal focus on the very first render; do it for client navigations.
  if (from.name === undefined) return;
  const main = document.getElementById('main');
  main?.focus({ preventScroll: true });
});

export default router;