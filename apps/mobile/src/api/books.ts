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
