import { useState, useEffect, useCallback } from 'react';
import { useAtom } from 'jotai';
import { Stack, Paper, Title, Group } from '@mantine/core';
import { IconClock, IconBooks, IconListNumbers } from '@tabler/icons-react';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import { PageHeader } from '../components/PageHeader';
import { DashboardSettingsModal } from '../components/DashboardSettingsModal';
import { ReadingQueueSection } from '../components/ReadingQueueSection';
import type { BookCardData } from '../components/BookCard';
import { userSettingsAtom, DEFAULT_USER_SETTINGS } from '../store/atoms';
import type { DashboardSection } from '../store/atoms';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';
import { useReadingQueue } from '../hooks/useReadingQueue';

interface InProgressEntry {
  bookId: string;
  percentage: number | null;
  lastSyncedAt: string;
  book: BookCardData;
}

export function Dashboard() {
  const [recentlyAdded, setRecentlyAdded] = useState<BookCardData[]>([]);
  const [inProgress, setInProgress] = useState<BookCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userSettings, setUserSettings] = useAtom(userSettingsAtom);
  const {
    queue,
    loading: queueLoading,
    fetchQueue,
    removeBook,
    reorder,
  } = useReadingQueue();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const [booksRes, progressRes] = await Promise.all([
        api
          .get<BookCardData[]>('/books?limit=10&sortBy=createdAt&order=desc')
          .catch(() => null),
        api.get<InProgressEntry[]>('/reading-progress').catch(() => null),
      ]);
      if (signal?.aborted) return;
      if (booksRes) setRecentlyAdded(booksRes.data);
      if (progressRes) {
        setInProgress(
          progressRes.data.map((e) => ({
            ...e.book,
            readingProgress: e.percentage,
          })),
        );
      }
      setLoading(false);
      void fetchQueue();
    },
    [fetchQueue],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function saveLayout(newLayout: typeof userSettings.dashboardLayout) {
    setUserSettings((prev) => ({ ...prev, dashboardLayout: newLayout }));
    setSettingsOpen(false);
    await api.patch('/users/me/settings', { dashboardLayout: newLayout });
  }

  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;

  // Merge in any new default sections that existing users don't have stored yet
  const mergedLayout: DashboardSection[] = [
    ...userSettings.dashboardLayout,
    ...DEFAULT_USER_SETTINGS.dashboardLayout
      .filter(
        (def) => !userSettings.dashboardLayout.some((s) => s.key === def.key),
      )
      .map((def, i) => ({
        ...def,
        order: userSettings.dashboardLayout.length + i,
      })),
  ];

  const sorted = [...mergedLayout]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.visible);

  return (
    <Stack>
      <PageHeader
        title="Dashboard"
        onSettingsClick={() => setSettingsOpen(true)}
      />

      {sorted.map((section) => {
        if (section.key === 'currently-reading') {
          return (
            <Paper key={section.key} withBorder p="md" radius="md">
              <Group mb="md" gap="xs">
                <IconBooks size={20} />
                <Title order={4}>Currently Reading</Title>
              </Group>
              <BookGrid
                books={inProgress}
                loading={loading}
                minWidth={minWidth}
                skeletonCount={4}
                emptyMessage="No books in progress. Start reading one from your library."
                onBookClick={setSelectedBookId}
              />
            </Paper>
          );
        }
        if (section.key === 'recently-added') {
          return (
            <Paper key={section.key} withBorder p="md" radius="md">
              <Group mb="md" gap="xs">
                <IconClock size={20} />
                <Title order={4}>Recently Added</Title>
              </Group>
              <BookGrid
                books={recentlyAdded}
                loading={loading}
                minWidth={minWidth}
                skeletonCount={5}
                emptyMessage="No books yet. Add some ebooks to your library folder."
                onBookClick={setSelectedBookId}
              />
            </Paper>
          );
        }
        if (section.key === 'reading-queue') {
          return (
            <Paper key={section.key} withBorder p="md" radius="md">
              <Group mb="md" gap="xs">
                <IconListNumbers size={20} />
                <Title order={4}>Reading Queue</Title>
              </Group>
              <ReadingQueueSection
                queue={queue}
                loading={queueLoading}
                minWidth={minWidth}
                onReorder={reorder}
                onRemove={removeBook}
                onBookClick={setSelectedBookId}
              />
            </Paper>
          );
        }
        return null;
      })}

      <DashboardSettingsModal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        layout={mergedLayout}
        onSave={(layout) => void saveLayout(layout)}
      />

      <BookDetailModal
        bookId={selectedBookId}
        onClose={() => setSelectedBookId(null)}
        onBookUpdated={() => void load()}
      />
    </Stack>
  );
}
