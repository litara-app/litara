import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  Stack,
  Modal,
  Text,
  SegmentedControl,
  ActionIcon,
  Indicator,
  Button,
  Group,
} from '@mantine/core';
import { IconFilter, IconCheckbox } from '@tabler/icons-react';
import { api } from '../utils/api';
import { BookGrid } from '../components/BookGrid';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { PageHeader } from '../components/PageHeader';
import { BookFilterPanel } from '../components/BookFilterPanel';
import { useBookFilter } from '../hooks/useBookFilter';
import type { BookCardData } from '../components/BookCard';
import {
  userSettingsAtom,
  selectedBookIdsAtom,
  isSelectModeAtom,
} from '../store/atoms';
import type { UserSettings } from '../store/atoms';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';

export function AllBooksPage() {
  const navigate = useNavigate();
  const { saveScroll, restoreScroll, pathname } = useScrollRestoration();
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const cancelRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userSettings, setUserSettings] = useAtom(userSettingsAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;
  const selectedBookIds = useAtomValue(selectedBookIdsAtom);
  const setSelectedBookIds = useSetAtom(selectedBookIdsAtom);
  const isSelectMode = useAtomValue(isSelectModeAtom);
  const [selectModeActive, setSelectModeActive] = useState(false);

  const {
    filters,
    setFilters,
    filteredBooks,
    panelOpen,
    setPanelOpen,
    activeCount,
    availableGenres,
    availableTags,
    availableFormats,
    availableMoods,
    availablePublishers,
    availableAuthors,
  } = useBookFilter(books);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedBookIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function toggleSelectMode() {
    if (selectModeActive) {
      setSelectModeActive(false);
      setSelectedBookIds(new Set());
    } else {
      setSelectModeActive(true);
    }
  }

  function handleToggleSelect(id: string) {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    const allIds = new Set(filteredBooks.map((b) => b.id));
    const allSelected = filteredBooks.every((b) => selectedBookIds.has(b.id));
    setSelectedBookIds(allSelected ? new Set() : allIds);
  }

  // Exit select mode when selection is cleared externally (e.g. route change)
  useEffect(() => {
    if (!isSelectMode) setSelectModeActive(false);
  }, [isSelectMode]);

  const BATCH_SIZE = 1000;

  const loadBooks = useCallback(async () => {
    cancelRef.current = false;
    setLoading(true);
    setLoadingMore(false);

    try {
      let offset = 0;
      let accumulated: BookCardData[] = [];

      while (!cancelRef.current) {
        const res = await api.get<BookCardData[]>(
          `/books?limit=${BATCH_SIZE}&offset=${offset}&sortBy=title&order=asc`,
        );
        if (cancelRef.current) break;

        const batch: BookCardData[] = res.data;
        accumulated = [...accumulated, ...batch];
        setBooks(accumulated);
        setLoading(false);

        if (batch.length < BATCH_SIZE) break;

        setLoadingMore(true);
        offset += BATCH_SIZE;
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadBooks();
    return () => {
      cancelRef.current = true;
    };
  }, [loadBooks]);

  useEffect(() => {
    if (!loading) restoreScroll();
  }, [loading, restoreScroll]);

  function handleBookClick(bookId: string) {
    saveScroll();
    navigate(`/books/${bookId}`, { state: { from: pathname } });
  }

  async function handleSizeChange(size: UserSettings['bookItemSize']) {
    setUserSettings((prev) => ({ ...prev, bookItemSize: size }));
    await api.patch('/users/me/settings', { bookItemSize: size });
  }

  return (
    <Stack>
      <PageHeader
        title="All Books"
        onSettingsClick={() => setSettingsOpen(true)}
        rightActions={
          <Group gap="xs">
            {selectModeActive && (
              <Button variant="subtle" size="xs" onClick={handleSelectAll}>
                {filteredBooks.every((b) => selectedBookIds.has(b.id))
                  ? 'Deselect All'
                  : 'Select All'}
              </Button>
            )}
            <ActionIcon
              variant={selectModeActive ? 'filled' : 'subtle'}
              size="md"
              onClick={toggleSelectMode}
              aria-label="Toggle select mode"
            >
              <IconCheckbox size={18} />
            </ActionIcon>
            <Indicator
              label={activeCount}
              disabled={activeCount === 0}
              size={16}
            >
              <ActionIcon
                variant={panelOpen ? 'filled' : 'subtle'}
                size="md"
                onClick={() => setPanelOpen((v) => !v)}
                aria-label="Toggle filters"
              >
                <IconFilter size={18} />
              </ActionIcon>
            </Indicator>
          </Group>
        }
      />

      {loadingMore && (
        <Text size="xs" c="dimmed">
          Loading more books ({books.length.toLocaleString()} loaded)…
        </Text>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <BookGrid
            books={filteredBooks}
            loading={loading}
            minWidth={minWidth}
            skeletonCount={12}
            emptyMessage={
              activeCount > 0
                ? 'No books match the current filters.'
                : 'No books found. Add a watched folder in Settings to start importing.'
            }
            onBookClick={handleBookClick}
            onBookSend={handleBookClick}
            onBookRatingChange={(id, rating) =>
              setBooks((prev) =>
                prev.map((b) => (b.id === id ? { ...b, rating } : b)),
              )
            }
            isSelectMode={selectModeActive}
            selectedIds={selectedBookIds}
            onToggleSelect={handleToggleSelect}
          />
        </div>
        <div
          style={{
            width: panelOpen ? 280 : 0,
            overflow: 'hidden',
            transition: 'width 200ms ease',
            flexShrink: 0,
            alignSelf: 'flex-start',
          }}
        >
          <BookFilterPanel
            filters={filters}
            setFilters={setFilters}
            availableGenres={availableGenres}
            availableTags={availableTags}
            availableFormats={availableFormats}
            availableMoods={availableMoods}
            availablePublishers={availablePublishers}
            availableAuthors={availableAuthors}
            activeCount={activeCount}
          />
        </div>
      </div>

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
    </Stack>
  );
}
