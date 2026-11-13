import { api } from './client';
import type { BookSummary } from './books';

export interface SmartShelf {
  id: string;
  name: string;
  logic: string;
  ruleCount: number;
}

export interface SmartShelfBooksResponse {
  total: number;
  books: BookSummary[];
}

export function getSmartShelves(): Promise<SmartShelf[]> {
  return api.get<SmartShelf[]>('/smart-shelves').then((r) => r.data);
}

export function getSmartShelfBooks(
  id: string,
): Promise<SmartShelfBooksResponse> {
  return api
    .get<SmartShelfBooksResponse>(`/smart-shelves/${id}/books`)
    .then((r) => r.data);
}
