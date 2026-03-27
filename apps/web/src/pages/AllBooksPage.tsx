import { useState, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { Title, Stack } from '@mantine/core';

import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import type { BookCardData } from '../components/BookCard';
import { userSettingsAtom } from '../store/atoms';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';

export function AllBooksPage() {
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const userSettings = useAtomValue(userSettingsAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<BookCardData[]>(
        '/books?limit=500&sortBy=title&order=asc',
      );
      setBooks(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  return (
    <Stack>
      <Title order={2}>All Books</Title>

      <BookGrid
        books={books}
        loading={loading}
        minWidth={minWidth}
        skeletonCount={12}
        emptyMessage="No books found. Add a watched folder in Settings to start importing."
        onBookClick={setSelectedBookId}
      />

      <BookDetailModal
        bookId={selectedBookId}
        onClose={() => setSelectedBookId(null)}
        onBookUpdated={() => void loadBooks()}
      />
    </Stack>
  );
}
