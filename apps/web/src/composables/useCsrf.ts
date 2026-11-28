/** Read/refresh the double-submit CSRF token when a component needs it. */
import { ref, type Ref } from 'vue';
import { readCsrfToken, refreshCsrf } from '@/api/client';

export type CsrfHandle = {
  token: Ref<string>;
  /** Force `GET /auth/csrf` and return the (possibly unchanged) token. */
  refresh: () => Promise<string>;
  /** Return the current token, fetching one only when missing. */
  ensure: () => Promise<string>;
};

export function useCsrf(): CsrfHandle {
  const token = ref(readCsrfToken());

  async function refresh(): Promise<string> {
    token.value = await refreshCsrf();
    return token.value;
  }

  async function ensure(): Promise<string> {
    const current = readCsrfToken();
    if (current) {
      token.value = current;
      return current;
    }
    return refresh();
  }

  return { token, refresh, ensure };
}