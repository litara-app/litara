import { api } from './client';

export interface ReadingQueueItem {
  id: string;
  bookId: string;
  position: number;
  addedAt: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
  hasFileMissing: boolean;
}

export async function getReadingQueue(): Promise<ReadingQueueItem[]> {
  const { data } = await api.get<ReadingQueueItem[]>('/reading-queue');
  return data;
}

export async function addToQueue(bookId: string): Promise<ReadingQueueItem> {
  const { data } = await api.post<ReadingQueueItem>('/reading-queue', {
    bookId,
  });
  return data;
}

export async function removeFromQueue(bookId: string): Promise<void> {
  await api.delete(`/reading-queue/${bookId}`);
}

export async function reorderQueue(bookIds: string[]): Promise<void> {
  await api.put('/reading-queue/order', { bookIds });
}
