export const FORMAT_COLORS: Record<string, string> = {
  EPUB: 'green',
  MOBI: 'blue',
  AZW: 'orange',
  AZW3: 'yellow',
  CBZ: 'violet',
  PDF: 'red',
};

export const ALL_LOCKABLE_FIELDS = [
  'title',
  'subtitle',
  'description',
  'isbn13',
  'isbn10',
  'publisher',
  'publishedDate',
  'language',
  'pageCount',
  'ageRating',
  'authors',
  'tags',
  'genres',
  'moods',
  'seriesName',
  'seriesPosition',
  'seriesTotalBooks',
];

export interface BookFile {
  id: string;
  format: string;
  sizeBytes: string;
  filePath: string;
  missingAt: string | null;
}

export interface BookDetail {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  isbn13: string | null;
  isbn10: string | null;
  goodreadsId: string | null;
  goodreadsRating: number | null;
  publisher: string | null;
  publishedDate: string | null;
  language: string | null;
  pageCount: number | null;
  ageRating: string | null;
  lockedFields: string[];
  hasCover: boolean;
  coverUpdatedAt: string;
  library: { id: string; name: string } | null;
  authors: string[];
  tags: string[];
  genres: string[];
  moods: string[];
  series: {
    id: string;
    name: string;
    sequence: number | null;
    totalBooks: number | null;
  } | null;
  files: BookFile[];
  userReview: { rating: number | null; readStatus: string };
  shelves: { id: string; name: string }[];
  sidecarFile: string | null;
}

export interface EditedFields {
  title: string;
  subtitle: string;
  description: string;
  isbn13: string;
  isbn10: string;
  publisher: string;
  publishedYear: string;
  language: string;
  pageCount: number | '';
  ageRating: string;
  authors: string[];
  tags: string[];
  genres: string[];
  moods: string[];
  seriesName: string;
  seriesPosition: number | '';
  seriesTotalBooks: number | '';
}

import type { MetadataResult } from '@litara/book-types';

export type { MetadataResult };

export interface MetadataSearchResult {
  provider: 'open-library' | 'google-books' | 'goodreads' | 'hardcover';
  providerLabel: string;
  result: MetadataResult;
}

export interface Library {
  id: string;
  name: string;
}

export interface Shelf {
  id: string;
  name: string;
}

export interface BookSummary {
  id: string;
  title: string;
  authors: string[];
}
