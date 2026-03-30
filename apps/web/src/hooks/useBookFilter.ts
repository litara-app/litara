import { useState, useMemo } from 'react';
import type { BookCardData } from '../components/BookCard';
import {
  type BookFilterState,
  type ReadStatusValue,
  EMPTY_FILTER,
  countActiveFilters,
} from '../types/bookFilter';

export function useBookFilter(books: BookCardData[]) {
  const [filters, setFilters] = useState<BookFilterState>(EMPTY_FILTER);
  const [panelOpen, setPanelOpen] = useState(false);

  const availableGenres = useMemo(
    () => [...new Set(books.flatMap((b) => b.genres))].sort(),
    [books],
  );
  const availableTags = useMemo(
    () => [...new Set(books.flatMap((b) => b.tags))].sort(),
    [books],
  );
  const availableFormats = useMemo(
    () => [...new Set(books.flatMap((b) => b.formats))].sort(),
    [books],
  );

  const filteredBooks = useMemo(() => {
    return books.filter((book) => {
      if (filters.readStatuses.length > 0) {
        const status = (book.readStatus ?? 'UNREAD') as ReadStatusValue;
        if (!filters.readStatuses.includes(status)) return false;
      }

      if (filters.minRating !== null) {
        if (book.rating === null || book.rating < filters.minRating)
          return false;
      }

      if (
        filters.formats.length > 0 &&
        !filters.formats.some((fmt) => book.formats.includes(fmt))
      )
        return false;

      if (
        filters.genres.length > 0 &&
        !filters.genres.some((g) => book.genres.includes(g))
      )
        return false;

      if (
        filters.tags.length > 0 &&
        !filters.tags.some((t) => book.tags.includes(t))
      )
        return false;

      if (filters.seriesFilter === 'has-series' && !book.seriesName)
        return false;
      if (filters.seriesFilter === 'no-series' && book.seriesName) return false;

      return true;
    });
  }, [books, filters]);

  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  return {
    filters,
    setFilters,
    filteredBooks,
    panelOpen,
    setPanelOpen,
    activeCount,
    availableGenres,
    availableTags,
    availableFormats,
  };
}
