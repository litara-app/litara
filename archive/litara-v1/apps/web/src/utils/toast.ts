import { getDefaultStore } from 'jotai';
import { toastsAtom } from '../store/atoms';

let counter = 0;

interface ToastOptions {
  title?: string;
  color?: string;
  duration?: number;
}

export function pushToast(message: string, options?: ToastOptions): void {
  const store = getDefaultStore();
  const id = String(++counter);
  const duration = options?.duration ?? 5000;

  store.set(toastsAtom, (prev) => [
    ...prev,
    { id, message, title: options?.title, color: options?.color ?? 'blue' },
  ]);

  setTimeout(() => {
    store.set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
  }, duration);
}
