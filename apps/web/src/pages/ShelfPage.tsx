import { useState, useEffect, useCallback } from 'react';
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
} from '@mantine/core';
import { IconCheckbox } from '@tabler/icons-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSetAtom, useAtomValue, useAtom } from 'jotai';
import { api } from '../utils/api';
import {
  shelvesAtom,
  userSettingsAtom,
  selectedBookIdsAtom,
  isSelectModeAtom,
} from '../store/atoms';
import type { Shelf } from '../store/atoms';
import { BookGrid } from '../components/BookGrid';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { PageHeader } from '../components/PageHeader';
import type { BookCardData } from '../components/BookCard';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';
import { pushToast } from '../utils/toast';

export function ShelfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { saveScroll, restoreScroll, pathname } = useScrollRestoration();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loadingShelf, setLoadingShelf] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const setShelves = useSetAtom(shelvesAtom);
  const userSettings = useAtomValue(userSettingsAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;
  const [selectedBookIds, setSelectedBookIds] = useAtom(selectedBookIdsAtom);
  const isSelectMode = useAtomValue(isSelectModeAtom);
  const [selectModeActive, setSelectModeActive] = useState(false);

  useEffect(() => {
    setSelectedBookIds(new Set());
    setSelectModeActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    const allIds = new Set(books.map((b) => b.id));
    const allSelected = books.every((b) => selectedBookIds.has(b.id));
    setSelectedBookIds(allSelected ? new Set() : allIds);
  }

  const loadBooks = useCallback(async () => {
    if (!id) return;
    setLoadingBooks(true);
    try {
      const res = await api.get<BookCardData[]>(`/shelves/${id}/books`);
      setBooks(res.data);
    } finally {
      setLoadingBooks(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoadingShelf(true);
    api
      .get<Shelf>(`/shelves/${id}`)
      .then((r) => {
        setShelf(r.data);
        setEditName(r.data.name);
      })
      .finally(() => setLoadingShelf(false));
    void loadBooks();
  }, [id, loadBooks]);

  useEffect(() => {
    if (!loadingBooks) restoreScroll();
  }, [loadingBooks, restoreScroll]);

  function handleBookClick(bookId: string) {
    saveScroll();
    navigate(`/books/${bookId}`, { state: { from: pathname } });
  }

  function openSettings() {
    setEditName(shelf?.name ?? '');
    setConfirmDelete(false);
    setSettingsOpen(true);
  }

  async function handleSave() {
    if (!shelf || !editName.trim()) return;
    const trimmed = editName.trim();
    if (trimmed === shelf.name) {
      setSettingsOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch<Shelf>(`/shelves/${shelf.id}`, {
        name: trimmed,
      });
      setShelf(res.data);
      setShelves((prev) =>
        prev.map((s) => (s.id === res.data.id ? res.data : s)),
      );
      pushToast('Shelf renamed', { color: 'green' });
      setSettingsOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!shelf) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await api.delete(`/shelves/${shelf.id}`);
      setShelves((prev) => prev.filter((s) => s.id !== shelf.id));
      pushToast('Shelf deleted', { color: 'green' });
      navigate('/');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Stack>
      {loadingShelf ? (
        <Skeleton height={36} width={200} radius="sm" />
      ) : (
        <PageHeader
          title={<Title order={2}>{shelf?.name}</Title>}
          onSettingsClick={openSettings}
          rightActions={
            <Group gap="xs">
              {selectModeActive && (
                <Button variant="subtle" size="xs" onClick={handleSelectAll}>
                  {books.every((b) => selectedBookIds.has(b.id))
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
            </Group>
          }
        />
      )}

      <BookGrid
        books={books}
        loading={loadingBooks}
        minWidth={minWidth}
        skeletonCount={5}
        emptyMessage="No books on this shelf yet."
        onBookClick={handleBookClick}
        isSelectMode={selectModeActive}
        selectedIds={selectedBookIds}
        onToggleSelect={handleToggleSelect}
      />

      <Modal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Shelf Settings"
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
              Delete Shelf
            </Button>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
