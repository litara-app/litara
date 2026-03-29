import { useState, useEffect, useCallback } from 'react';
import { useAtom } from 'jotai';
import { Stack, Modal, Text, SegmentedControl } from '@mantine/core';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import { PageHeader } from '../components/PageHeader';
import type { BookCardData } from '../components/BookCard';
import { userSettingsAtom } from '../store/atoms';
import type { UserSettings } from '../store/atoms';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';

export function AllBooksPage() {
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userSettings, setUserSettings] = useAtom(userSettingsAtom);
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

  async function handleSizeChange(size: UserSettings['bookItemSize']) {
    setUserSettings((prev) => ({ ...prev, bookItemSize: size }));
    await api.patch('/users/me/settings', { bookItemSize: size });
  }

  return (
    <Stack>
      <PageHeader
        title="All Books"
        onSettingsClick={() => setSettingsOpen(true)}
      />

      <BookGrid
        books={books}
        loading={loading}
        minWidth={minWidth}
        skeletonCount={12}
        emptyMessage="No books found. Add a watched folder in Settings to start importing."
        onBookClick={setSelectedBookId}
      />

      <Modal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="All Books Settings"
        size="sm"
        centered
      >
        <Stack gap="sm">
          <div>
            <Text size="sm" fw={500} mb={4}>
              Book size
            </Text>
            <SegmentedControl
              value={userSettings.bookItemSize}
              onChange={(v) =>
                void handleSizeChange(v as UserSettings['bookItemSize'])
              }
              data={[
                { label: 'S', value: 'sm' },
                { label: 'M', value: 'md' },
                { label: 'L', value: 'lg' },
                { label: 'XL', value: 'xl' },
              ]}
              fullWidth
            />
          </div>
        </Stack>
      </Modal>

      <BookDetailModal
        bookId={selectedBookId}
        onClose={() => setSelectedBookId(null)}
        onBookUpdated={() => void loadBooks()}
      />
    </Stack>
  );
}
