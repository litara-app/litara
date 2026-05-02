import { api } from './client';
import type { AudiobookFileInfo, AudiobookProgress } from './audiobooks';

export interface BookSummary {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt?: string;
  formats: string[];
  hasFileMissing: boolean;
  readingProgress?: number | null;
  seriesName?: string | null;
  readStatus: string | null;
  rating: number | null;
  genres: string[];
  tags: string[];
  moods: string[];
  publisher: string | null;
  pageCount: number | null;
  goodreadsRating: number | null;
  publishedDate: string | null;
  createdAt: string;
  hasAudiobook: boolean;
}

export interface BookFile {
  id: string;
  format: string;
  sizeBytes: string;
  filePath: string;
  missingAt: Date | null;
}

export interface BookSeries {
  name: string;
  sequence: number | null;
  totalBooks: number | null;
}

export interface BookDetail {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  isbn13: string | null;
  isbn10: string | null;
  publisher: string | null;
  publishedDate: string | null;
  language: string | null;
  pageCount: number | null;
  hasCover: boolean;
  coverUpdatedAt: string;
  authors: string[];
  tags: string[];
  genres: string[];
  moods: string[];
  series: BookSeries | null;
  files: BookFile[];
  goodreadsRating: number | null;
  userReview: {
    rating: number | null;
    readStatus: string;
  };
  library: { id: string; name: string } | null;
  shelves: { id: string; name: string }[];
  inReadingQueue: boolean;
  hasAudiobook: boolean;
  audiobookFiles: AudiobookFileInfo[];
  audiobookProgress: AudiobookProgress | null;
}

export async function getBooks(params?: {
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'title' | 'publishedDate';
  order?: 'asc' | 'desc';
  q?: string;
  libraryId?: string;
}): Promise<BookSummary[]> {
  const { data } = await api.get<BookSummary[]>('/books', { params });
  return data;
}

export async function getAllBooks(): Promise<BookSummary[]> {
  const BATCH = 1000;
  const all: BookSummary[] = [];
  let offset = 0;
  while (true) {
    const batch = await getBooks({
      limit: BATCH,
      offset,
      sortBy: 'title',
      order: 'asc',
    });
    all.push(...batch);
    if (batch.length < BATCH) break;
    offset += BATCH;
  }
  return all;
}

export async function getBookDetail(id: string): Promise<BookDetail> {
  const { data } = await api.get<BookDetail>(`/books/${id}`);
  return data;
}

export interface ProgressEntry {
  source: 'LITARA' | 'KOREADER';
  percentage: number | null;
  lastSyncedAt: string;
}

export async function getReadingProgress(
  bookId: string,
): Promise<ProgressEntry[]> {
  const { data } = await api.get<ProgressEntry[]>(
    `/books/${bookId}/progress/all`,
  );
  return data ?? [];
}

export async function resetReadingProgress(
  bookId: string,
  source?: 'LITARA' | 'KOREADER',
): Promise<void> {
  const url = source
    ? `/books/${bookId}/progress?source=${source}`
    : `/books/${bookId}/progress`;
  await api.delete(url);
}

export function updateBook(
  id: string,
  dto: { rating?: number | null; libraryId?: string | null },
): Promise<void> {
  return api.patch(`/books/${id}`, dto);
}

export function updateBookShelves(
  id: string,
  shelfIds: string[],
): Promise<void> {
  return api.put(`/books/${id}/shelves`, { shelfIds });
}
