import { useState, useMemo } from 'react';
import type { BookSummary } from '@/src/api/books';
import {
  type BookFilterState,
  type ReadStatusValue,
  EMPTY_FILTER,
  countActiveFilters,
} from '@/src/types/bookFilter';

const PAGE_COUNT_SHORT = 150;
const PAGE_COUNT_MEDIUM = 400;

const ADDED_FILTER_DAYS: Record<string, number> = {
  'last-7': 7,
  'last-30': 30,
  'last-180': 180,
};

function buildPredicates(
  filters: BookFilterState,
  book: BookSummary,
): boolean[] {
  const predicates: boolean[] = [];

  if (filters.readStatuses.length > 0) {
    const status = (book.readStatus ?? 'UNREAD') as ReadStatusValue;
    predicates.push(filters.readStatuses.includes(status));
  }

  if (filters.minRating !== null) {
    predicates.push(book.rating !== null && book.rating >= filters.minRating);
  }

  if (filters.minGoodreadsRating !== null) {
    predicates.push(
      book.goodreadsRating !== null &&
        book.goodreadsRating >= filters.minGoodreadsRating,
    );
  }

  if (filters.formats.length > 0) {
    predicates.push(filters.formats.some((fmt) => book.formats.includes(fmt)));
  }

  if (filters.genres.length > 0) {
    predicates.push(filters.genres.some((g) => book.genres.includes(g)));
  }

  if (filters.tags.length > 0) {
    predicates.push(filters.tags.some((t) => book.tags.includes(t)));
  }

  if (filters.moods.length > 0) {
    predicates.push(filters.moods.some((m) => book.moods.includes(m)));
  }

  if (filters.authors.length > 0) {
    predicates.push(filters.authors.some((a) => book.authors.includes(a)));
  }

  if (filters.publishers.length > 0) {
    predicates.push(
      book.publisher !== null && filters.publishers.includes(book.publisher),
    );
  }

  if (filters.seriesFilter === 'has-series') {
    predicates.push(!!book.seriesName);
  } else if (filters.seriesFilter === 'no-series') {
    predicates.push(!book.seriesName);
  }

  if (filters.mediaTypeFilter !== 'any') {
    const hasEbook = book.formats.length > 0;
    const hasAudio = book.hasAudiobook;
    if (filters.mediaTypeFilter === 'ebook-only')
      predicates.push(hasEbook && !hasAudio);
    else if (filters.mediaTypeFilter === 'audiobook-only')
      predicates.push(hasAudio && !hasEbook);
    else if (filters.mediaTypeFilter === 'both')
      predicates.push(hasEbook && hasAudio);
  }

  if (filters.pageCountFilter !== 'any') {
    const pc = book.pageCount ?? null;
    if (pc === null) {
      predicates.push(false);
    } else if (filters.pageCountFilter === 'short') {
      predicates.push(pc < PAGE_COUNT_SHORT);
    } else if (filters.pageCountFilter === 'medium') {
      predicates.push(pc >= PAGE_COUNT_SHORT && pc <= PAGE_COUNT_MEDIUM);
    } else {
      predicates.push(pc > PAGE_COUNT_MEDIUM);
    }
  }

  if (filters.publishedYearFrom !== null || filters.publishedYearTo !== null) {
    const year = book.publishedDate
      ? new Date(book.publishedDate).getFullYear()
      : null;
    if (year === null) {
      predicates.push(false);
    } else {
      if (filters.publishedYearFrom !== null)
        predicates.push(year >= filters.publishedYearFrom);
      if (filters.publishedYearTo !== null)
        predicates.push(year <= filters.publishedYearTo);
    }
  }

  if (filters.addedFilter !== 'any' && book.createdAt) {
    const days = ADDED_FILTER_DAYS[filters.addedFilter];
    if (days !== undefined) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      predicates.push(new Date(book.createdAt).getTime() >= cutoff);
    }
  }

  return predicates;
}

export interface AuthorOption {
  name: string;
  count: number;
}

export function useBookFilter(books: BookSummary[]) {
  const [filters, setFilters] = useState<BookFilterState>(EMPTY_FILTER);

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
  const availableMoods = useMemo(
    () => [...new Set(books.flatMap((b) => b.moods))].sort(),
    [books],
  );
  const availablePublishers = useMemo(
    () =>
      [
        ...new Set(books.map((b) => b.publisher).filter(Boolean) as string[]),
      ].sort(),
    [books],
  );
  const availableAuthors = useMemo<AuthorOption[]>(() => {
    const countMap = new Map<string, number>();
    for (const book of books) {
      for (const author of book.authors) {
        countMap.set(author, (countMap.get(author) ?? 0) + 1);
      }
    }
    return [...countMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [books]);

  const filteredBooks = useMemo(() => {
    return books.filter((book) => {
      const predicates = buildPredicates(filters, book);
      if (predicates.length === 0) return true;
      if (filters.filterMode === 'and') return predicates.every(Boolean);
      if (filters.filterMode === 'or') return predicates.some(Boolean);
      return !predicates.some(Boolean); // NOT
    });
  }, [books, filters]);

  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  return {
    filters,
    setFilters,
    filteredBooks,
    activeCount,
    availableGenres,
    availableTags,
    availableFormats,
    availableMoods,
    availablePublishers,
    availableAuthors,
  };
}
