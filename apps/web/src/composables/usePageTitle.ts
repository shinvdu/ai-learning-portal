/** Set `document.title` for a view; the router guard sets the static meta title. */
import { toValue, watchEffect, type MaybeRefOrGetter } from 'vue';

export const SITE_TITLE = 'AI 学习与数据分析门户';

export function usePageTitle(title: MaybeRefOrGetter<string | null | undefined>): void {
  watchEffect(() => {
    const value = toValue(title);
    const text = value?.trim();
    if (typeof document !== 'undefined') {
      document.title = text ? `${text} · ${SITE_TITLE}` : SITE_TITLE;
    }
  });
}