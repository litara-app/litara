export type ReadStatusValue = 'UNREAD' | 'READING' | 'READ' | 'WONT_READ';
export type SeriesFilter = 'any' | 'has-series' | 'no-series';
export type FilterMode = 'and' | 'or' | 'not';
export type AddedFilter = 'any' | 'last-7' | 'last-30' | 'last-180';
export type PageCountFilter = 'any' | 'short' | 'medium' | 'long';
export type MediaTypeFilter = 'any' | 'ebook-only' | 'audiobook-only' | 'both';

export interface BookFilterState {
  filterMode: FilterMode;
  readStatuses: ReadStatusValue[];
  minRating: number | null;
  minGoodreadsRating: number | null;
  formats: string[];
  genres: string[];
  tags: string[];
  moods: string[];
  authors: string[];
  publishers: string[];
  seriesFilter: SeriesFilter;
  mediaTypeFilter: MediaTypeFilter;
  pageCountFilter: PageCountFilter;
  publishedYearFrom: number | null;
  publishedYearTo: number | null;
  addedFilter: AddedFilter;
}

export const EMPTY_FILTER: BookFilterState = {
  filterMode: 'and',
  readStatuses: [],
  minRating: null,
  minGoodreadsRating: null,
  formats: [],
  genres: [],
  tags: [],
  moods: [],
  authors: [],
  publishers: [],
  seriesFilter: 'any',
  mediaTypeFilter: 'any',
  pageCountFilter: 'any',
  publishedYearFrom: null,
  publishedYearTo: null,
  addedFilter: 'any',
};

export function countActiveFilters(f: BookFilterState): number {
  return (
    (f.readStatuses.length > 0 ? 1 : 0) +
    (f.minRating !== null ? 1 : 0) +
    (f.minGoodreadsRating !== null ? 1 : 0) +
    (f.formats.length > 0 ? 1 : 0) +
    (f.genres.length > 0 ? 1 : 0) +
    (f.tags.length > 0 ? 1 : 0) +
    (f.moods.length > 0 ? 1 : 0) +
    (f.authors.length > 0 ? 1 : 0) +
    (f.publishers.length > 0 ? 1 : 0) +
    (f.seriesFilter !== 'any' ? 1 : 0) +
    (f.mediaTypeFilter !== 'any' ? 1 : 0) +
    (f.pageCountFilter !== 'any' ? 1 : 0) +
    (f.publishedYearFrom !== null ? 1 : 0) +
    (f.publishedYearTo !== null ? 1 : 0) +
    (f.addedFilter !== 'any' ? 1 : 0)
  );
}
