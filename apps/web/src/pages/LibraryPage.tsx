import { useState, useEffect, useCallback, useRef } from 'react';
import { useSetAtom, useAtomValue, useAtom } from 'jotai';
import {
  Title,
  Stack,
  Skeleton,
  Modal,
  TextInput,
  Button,
  Divider,
  Text,
  Group,
  ActionIcon,
  Indicator,
} from '@mantine/core';
import { IconFilter, IconCheckbox } from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import { PageHeader } from '../components/PageHeader';
import { BookFilterPanel } from '../components/BookFilterPanel';
import { useBookFilter } from '../hooks/useBookFilter';
import type { BookCardData } from '../components/BookCard';
import {
  librariesAtom,
  userSettingsAtom,
  selectedBookIdsAtom,
  isSelectModeAtom,
} from '../store/atoms';
import type { Library } from '../store/atoms';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';
import { pushToast } from '../utils/toast';

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [library, setLibrary] = useState<Library | null>(null);
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loadingLib, setLoadingLib] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const cancelRef = useRef(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const setLibraries = useSetAtom(librariesAtom);
  const userSettings = useAtomValue(userSettingsAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;
  const [selectedBookIds, setSelectedBookIds] = useAtom(selectedBookIdsAtom);
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

  // Clear selection when library changes or filters change
  useEffect(() => {
    setSelectedBookIds(new Set());
    setSelectModeActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filters]);

  useEffect(() => {
    if (!isSelectMode) setSelectModeActive(false);
  }, [isSelectMode]);

  function toggleSelectMode() {
    if (selectModeActive) {
      setSelectModeActive(false);
      setSelectedBookIds(new Set());
    } else {
      setSelectModeActive(true);
    }
  }

  function handleToggleSelect(bookId: string) {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  function handleSelectAll() {
    const allIds = new Set(filteredBooks.map((b) => b.id));
    const allSelected = filteredBooks.every((b) => selectedBookIds.has(b.id));
    setSelectedBookIds(allSelected ? new Set() : allIds);
  }

  const BATCH_SIZE = 1000;

  const loadBooks = useCallback(async () => {
    if (!id) return;
    cancelRef.current = false;
    setLoadingBooks(true);
    setLoadingMore(false);

    try {
      let offset = 0;
      let accumulated: BookCardData[] = [];

      while (!cancelRef.current) {
        const res = await api.get<BookCardData[]>(
          `/books?libraryId=${id}&limit=${BATCH_SIZE}&offset=${offset}&sortBy=title&order=asc`,
        );
        if (cancelRef.current) break;

        const batch: BookCardData[] = res.data;
        accumulated = [...accumulated, ...batch];
        setBooks(accumulated);
        setLoadingBooks(false);

        if (batch.length < BATCH_SIZE) break;

        setLoadingMore(true);
        offset += BATCH_SIZE;
      }
    } finally {
      setLoadingBooks(false);
      setLoadingMore(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoadingLib(true);
    api
      .get<Library>(`/libraries/${id}`)
      .then((r) => {
        setLibrary(r.data);
        setEditName(r.data.name);
      })
      .finally(() => setLoadingLib(false));
    void loadBooks();
    return () => {
      cancelRef.current = true;
    };
  }, [id, loadBooks]);

  function openSettings() {
    setEditName(library?.name ?? '');
    setConfirmDelete(false);
    setSettingsOpen(true);
  }

  async function handleSave() {
    if (!library || !editName.trim()) return;
    const trimmed = editName.trim();
    if (trimmed === library.name) {
      setSettingsOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch<Library>(`/libraries/${library.id}`, {
        name: trimmed,
      });
      setLibrary(res.data);
      setLibraries((prev) =>
        prev.map((l) => (l.id === res.data.id ? res.data : l)),
      );
      pushToast('Library renamed', { color: 'green' });
      setSettingsOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!library) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await api.delete(`/libraries/${library.id}`);
      setLibraries((prev) => prev.filter((l) => l.id !== library.id));
      pushToast('Library deleted', { color: 'green' });
      navigate('/');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Stack>
      {loadingLib ? (
        <Skeleton height={36} width={200} radius="sm" />
      ) : (
        <PageHeader
          title={<Title order={2}>{library?.name}</Title>}
          onSettingsClick={openSettings}
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
      )}

      {loadingMore && (
        <Text size="xs" c="dimmed">
          Loading more books ({books.length.toLocaleString()} loaded)…
        </Text>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <BookGrid
            books={filteredBooks}
            loading={loadingBooks}
            minWidth={minWidth}
            skeletonCount={10}
            emptyMessage={
              activeCount > 0
                ? 'No books match the current filters.'
                : 'No books in this library yet.'
            }
            onBookClick={setSelectedBookId}
            onBookSend={setSelectedBookId}
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
        title="Library Settings"
        size="sm"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            value={editName}
            onChange={(e) => setEditName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
          />
          <Button onClick={() => void handleSave()} loading={saving} fullWidth>
            Save
          </Button>
          <Divider />
          {confirmDelete ? (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Are you sure? This cannot be undone.
              </Text>
              <Group grow>
                <Button
                  variant="default"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
                <Button
                  color="red"
                  onClick={() => void handleDelete()}
                  loading={deleting}
                >
                  Confirm Delete
                </Button>
              </Group>
            </Stack>
          ) : (
            <Button
              color="red"
              variant="light"
              onClick={() => void handleDelete()}
              fullWidth
            >
              Delete Library
            </Button>
          )}
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
