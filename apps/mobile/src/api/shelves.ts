import { api } from './client';
import type { BookSummary } from './books';

export interface Shelf {
  id: string;
  name: string;
  isSmart: boolean;
  createdAt: string;
}

export function getShelves(): Promise<Shelf[]> {
  return api.get<Shelf[]>('/shelves').then((r) => r.data);
}

export function getShelfBooks(shelfId: string): Promise<BookSummary[]> {
  return api
    .get<BookSummary[]>(`/shelves/${shelfId}/books`)
    .then((r) => r.data);
}

export function addBooksToShelf(
  shelfId: string,
  bookIds: string[],
): Promise<void> {
  return api.post(`/shelves/${shelfId}/books/bulk`, { bookIds });
}

export function removeBooksFromShelf(
  shelfId: string,
  bookIds: string[],
): Promise<void> {
  return api.delete(`/shelves/${shelfId}/books/bulk`, { data: { bookIds } });
}
