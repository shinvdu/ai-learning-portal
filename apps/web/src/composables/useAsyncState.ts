/**
 * Small async state helper used by views instead of a global business store.
 *
 * `run(task)` tracks loading/error, keeps only the latest result (out-of-order
 * responses are ignored) and normalises thrown values into a message.
 */
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { errorMessage } from '@/api/client';

export type AsyncState<T> = {
  data: ShallowRef<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  run: (task: () => Promise<T>) => Promise<T | null>;
  reset: () => void;
};

export function useAsyncState<T>(): AsyncState<T> {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let token = 0;

  async function run(task: () => Promise<T>): Promise<T | null> {
    const current = ++token;
    loading.value = true;
    error.value = null;
    try {
      const result = await task();
      if (current === token) {
        data.value = result;
        loading.value = false;
      }
      return result;
    } catch (thrown) {
      if (current === token) {
        error.value = errorMessage(thrown);
        loading.value = false;
      }
      return null;
    }
  }

  function reset(): void {
    token += 1;
    data.value = null;
    loading.value = false;
    error.value = null;
  }

  return { data, loading, error, run, reset };
}

/** Convenience wrapper for a single loader with an optional eager run. */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  options: { immediate?: boolean } = {},
): AsyncState<T> & { reload: () => Promise<T | null> } {
  const state = useAsyncState<T>();
  const reload = (): Promise<T | null> => state.run(loader);
  if (options.immediate) void reload();
  return { ...state, reload };
}