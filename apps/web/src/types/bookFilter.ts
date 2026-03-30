export type ReadStatusValue = 'UNREAD' | 'READING' | 'READ' | 'WONT_READ';
export type SeriesFilter = 'any' | 'has-series' | 'no-series';

export interface BookFilterState {
  readStatuses: ReadStatusValue[];
  minRating: number | null;
  formats: string[];
  genres: string[];
  tags: string[];
  seriesFilter: SeriesFilter;
}

export const EMPTY_FILTER: BookFilterState = {
  readStatuses: [],
  minRating: null,
  formats: [],
  genres: [],
  tags: [],
  seriesFilter: 'any',
};

export function countActiveFilters(f: BookFilterState): number {
  return (
    (f.readStatuses.length > 0 ? 1 : 0) +
    (f.minRating !== null ? 1 : 0) +
    (f.formats.length > 0 ? 1 : 0) +
    (f.genres.length > 0 ? 1 : 0) +
    (f.tags.length > 0 ? 1 : 0) +
    (f.seriesFilter !== 'any' ? 1 : 0)
  );
}
