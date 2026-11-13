import { api } from './client';

export interface InProgressBook {
  bookId: string;
  percentage: number | null;
  lastSyncedAt: string;
  book: {
    id: string;
    title: string;
    authors: string[];
    hasCover: boolean;
    coverUpdatedAt: string;
    formats: string[];
    hasFileMissing: boolean;
  };
}

export async function getInProgressBooks(): Promise<InProgressBook[]> {
  const { data } = await api.get<InProgressBook[]>('/reading-progress');
  return data;
}
