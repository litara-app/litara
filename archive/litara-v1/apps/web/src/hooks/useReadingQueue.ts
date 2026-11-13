import { useCallback } from 'react';
import { atom, useAtom, useSetAtom } from 'jotai';
import { arrayMove } from '@dnd-kit/sortable';
import { api } from '../utils/api';
import { readingQueueAtom } from '../store/atoms';
import type { ReadingQueueItem } from '../store/atoms';

const readingQueueLoadingAtom = atom(false);

interface UseReadingQueueReturn {
  queue: ReadingQueueItem[];
  loading: boolean;
  fetchQueue: () => Promise<void>;
  addBook: (bookId: string) => Promise<ReadingQueueItem>;
  removeBook: (bookId: string) => Promise<void>;
  reorder: (activeId: string, overId: string) => Promise<void>;
}

export function useReadingQueue(): UseReadingQueueReturn {
  const [queue, setQueue] = useAtom(readingQueueAtom);
  const [loading, setLoading] = useAtom(readingQueueLoadingAtom);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ReadingQueueItem[]>('/reading-queue');
      setQueue(res.data);
    } finally {
      setLoading(false);
    }
  }, [setQueue, setLoading]);

  const addBook = useCallback(
    async (bookId: string) => {
      const res = await api.post<ReadingQueueItem>('/reading-queue', {
        bookId,
      });
      setQueue((prev) => {
        if (prev.some((item) => item.bookId === bookId)) return prev;
        return [...prev, res.data];
      });
      return res.data;
    },
    [setQueue],
  );

  const removeBook = useCallback(
    async (bookId: string) => {
      setQueue((prev) => prev.filter((item) => item.bookId !== bookId));
      await api.delete(`/reading-queue/${bookId}`);
    },
    [setQueue],
  );

  const reorder = useCallback(
    async (activeId: string, overId: string) => {
      const oldIndex = queue.findIndex((item) => item.bookId === activeId);
      const newIndex = queue.findIndex((item) => item.bookId === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(queue, oldIndex, newIndex);
      setQueue(reordered);

      try {
        await api.put('/reading-queue/order', {
          bookIds: reordered.map((item) => item.bookId),
        });
      } catch {
        setQueue(queue);
      }
    },
    [queue, setQueue],
  );

  return { queue, loading, fetchQueue, addBook, removeBook, reorder };
}

// Lightweight hook for components that only need to add/remove (e.g. BookDetailModal)
export function useReadingQueueActions() {
  const setQueue = useSetAtom(readingQueueAtom);

  const addBook = useCallback(
    async (bookId: string) => {
      const res = await api.post<ReadingQueueItem>('/reading-queue', {
        bookId,
      });
      setQueue((prev) => {
        if (prev.some((item) => item.bookId === bookId)) return prev;
        return [...prev, res.data];
      });
    },
    [setQueue],
  );

  const removeBook = useCallback(
    async (bookId: string) => {
      setQueue((prev) => prev.filter((item) => item.bookId !== bookId));
      await api.delete(`/reading-queue/${bookId}`);
    },
    [setQueue],
  );

  return { addBook, removeBook };
}
