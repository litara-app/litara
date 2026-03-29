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
} from '@mantine/core';
import { useParams, useNavigate } from 'react-router-dom';
import { useSetAtom, useAtomValue } from 'jotai';
import { api } from '../utils/api';
import { shelvesAtom, userSettingsAtom } from '../store/atoms';
import type { Shelf } from '../store/atoms';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import { PageHeader } from '../components/PageHeader';
import type { BookCardData } from '../components/BookCard';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';
import { pushToast } from '../utils/toast';

export function ShelfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loadingShelf, setLoadingShelf] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const setShelves = useSetAtom(shelvesAtom);
  const userSettings = useAtomValue(userSettingsAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;

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
        />
      )}

      <BookGrid
        books={books}
        loading={loadingBooks}
        minWidth={minWidth}
        skeletonCount={5}
        emptyMessage="No books on this shelf yet."
        onBookClick={setSelectedBookId}
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

      <BookDetailModal
        bookId={selectedBookId}
        onClose={() => setSelectedBookId(null)}
        onBookUpdated={() => void loadBooks()}
      />
    </Stack>
  );
}
