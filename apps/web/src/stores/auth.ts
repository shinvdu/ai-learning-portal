/**
 * Session/auth state (Pinia). Only `auth` and `toast` live in stores — view
 * data stays in per-view composables so it never goes stale globally.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/api/endpoints';
import type {
  ClientUser,
  LoginResponse,
  MfaResponse,
  RegisterInput,
  RegisterResponse,
} from '@/api/types';

export type AuthStatus = 'idle' | 'loading' | 'ready';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<ClientUser | null>(null);
  const status = ref<AuthStatus>('idle');

  const isAdmin = computed(() => user.value?.role === 'admin');
  const isAuthenticated = computed(() => user.value !== null);

  let loadPromise: Promise<void> | null = null;

  function setUser(next: ClientUser | null): void {
    user.value = next;
    status.value = 'ready';
  }

  /** `auth:unauthorized` from the API client — drop the cached identity. */
  function handleUnauthorized(): void {
    user.value = null;
    status.value = 'ready';
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('auth:unauthorized', handleUnauthorized);
  }

  async function refresh(): Promise<ClientUser | null> {
    try {
      const { user: fresh } = await authApi.me();
      setUser(fresh);
      return fresh;
    } catch {
      setUser(null);
      return null;
    }
  }

  /** Load the session once on first navigation; safe to call repeatedly. */
  function ensureLoaded(): Promise<void> {
    if (status.value === 'ready') return Promise.resolve();
    if (loadPromise) return loadPromise;
    status.value = 'loading';
    loadPromise = refresh().then(
      () => undefined,
      () => {
        setUser(null);
      },
    );
    return loadPromise;
  }

  const bootstrap = ensureLoaded;

  async function login(email: string, password: string): Promise<LoginResponse> {
    const response = await authApi.login({ email, password });
    if ('user' in response) setUser(response.user);
    return response;
  }

  async function verifyMfa(challengeToken: string, code: string): Promise<MfaResponse> {
    const response = await authApi.mfa({ challengeToken, code });
    setUser(response.user);
    return response;
  }

  async function register(input: RegisterInput): Promise<RegisterResponse> {
    const response = await authApi.register(input);
    if ('user' in response) setUser(response.user);
    return response;
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch {
      /* logging out locally is still correct when the cookie is already gone */
    } finally {
      setUser(null);
    }
  }

  return {
    user,
    status,
    isAdmin,
    isAuthenticated,
    setUser,
    ensureLoaded,
    bootstrap,
    refresh,
    login,
    mfa: verifyMfa,
    verifyMfa,
    register,
    logout,
  };
});