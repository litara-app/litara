import { useAtom } from 'jotai';
import { Box, Notification } from '@mantine/core';
import { toastsAtom } from '../store/atoms';
import { getDefaultStore } from 'jotai';

function dismissToast(id: string) {
  const store = getDefaultStore();
  store.set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
}

export function ToastContainer() {
  const [toasts] = useAtom(toastsAtom);

  if (toasts.length === 0) return null;

  return (
    <Box
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 380,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <Notification
          key={toast.id}
          title={toast.title}
          color={toast.color ?? 'blue'}
          onClose={() => dismissToast(toast.id)}
          style={{ pointerEvents: 'all' }}
          withBorder
        >
          {toast.message}
        </Notification>
      ))}
    </Box>
  );
}
