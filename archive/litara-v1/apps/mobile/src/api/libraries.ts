import { api } from './client';
import type { BookSummary } from './books';

export interface Library {
  id: string;
  name: string;
  path: string;
  iconKey: string | null;
  lastScanAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getLibraries(): Promise<Library[]> {
  return api.get<Library[]>('/libraries').then((r) => r.data);
}

export function getLibraryBooks(libraryId: string): Promise<BookSummary[]> {
  return api
    .get<
      BookSummary[]
    >('/books', { params: { libraryId, limit: 200, sortBy: 'title', order: 'asc' } })
    .then((r) => r.data);
}
