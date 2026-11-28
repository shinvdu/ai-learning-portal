/** Global toast queue (Pinia). Rendered by `ToastHost.vue` with aria-live. */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'ok' | 'warn' | 'err' | 'info';

export type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

const DEFAULT_DURATION_MS = 4200;

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let seq = 0;

  function dismiss(id: number): void {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    items.value = items.value.filter((item) => item.id !== id);
  }

  function push(kind: ToastKind, message: string, durationMs = DEFAULT_DURATION_MS): number {
    const id = ++seq;
    // Keep the stack short so it never covers page controls.
    items.value = [...items.value.slice(-3), { id, kind, message }];
    if (durationMs > 0) {
      timers.set(
        id,
        setTimeout(() => dismiss(id), durationMs),
      );
    }
    return id;
  }

  const ok = (message: string, durationMs?: number): number =>
    push('ok', message, durationMs);
  const warn = (message: string, durationMs?: number): number =>
    push('warn', message, durationMs);
  const error = (message: string, durationMs?: number): number =>
    push('err', message, durationMs);
  const info = (message: string, durationMs?: number): number =>
    push('info', message, durationMs);

  function clear(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    items.value = [];
  }

  return { items, push, dismiss, clear, ok, warn, error, info };
});