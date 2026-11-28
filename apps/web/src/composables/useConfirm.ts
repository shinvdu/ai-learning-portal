/**
 * Promise-based confirmation dialog.
 *
 * `await confirm({ message: '...' })` resolves `true`/`false`. A single shared
 * state drives `ConfirmDialog.vue`, so any view can call the composable.
 */
import { reactive } from 'vue';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export type ConfirmState = {
  open: boolean;
  options: ConfirmOptions | null;
};

const state = reactive<ConfirmState>({
  open: false,
  options: null,
});

let resolver: ((value: boolean) => void) | null = null;

function settle(value: boolean): void {
  const resolve = resolver;
  resolver = null;
  state.open = false;
  resolve?.(value);
}

export function useConfirm() {
  return function confirm(input: ConfirmOptions | string): Promise<boolean> {
    // A second call while one is open replaces it (the previous promise
    // resolves false so its caller never hangs).
    if (resolver) settle(false);

    const options: ConfirmOptions =
      typeof input === 'string' ? { message: input } : { ...input };
    state.options = {
      title: options.title ?? '请确认',
      confirmText: options.confirmText ?? '确定',
      cancelText: options.cancelText ?? '取消',
      danger: options.danger ?? false,
      message: options.message,
    };
    state.open = true;

    return new Promise<boolean>((resolve) => {
      resolver = resolve;
    });
  };
}

/** Called by `ConfirmDialog.vue` (buttons and native close/Escape). */
export function resolveConfirm(value: boolean): void {
  settle(value);
}

/** Read-only-ish accessor for the dialog host. */
export function useConfirmState(): ConfirmState {
  return state;
}