/** Reactive `(max-width: 720px)` media query — matches the v1 breakpoint. */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export const COMPACT_MEDIA_QUERY = '(max-width: 720px)';

export function useCompact(): Ref<boolean> {
  const compact = ref(false);
  let query: MediaQueryList | null = null;

  const update = (event?: MediaQueryListEvent): void => {
    compact.value = event ? event.matches : (query?.matches ?? false);
  };

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    query = window.matchMedia(COMPACT_MEDIA_QUERY);
    compact.value = query.matches;
    query.addEventListener('change', update);
  });

  onBeforeUnmount(() => {
    query?.removeEventListener('change', update);
    query = null;
  });

  return compact;
}