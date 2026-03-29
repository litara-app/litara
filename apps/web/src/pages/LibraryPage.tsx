import { useState, useEffect, useCallback } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
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
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import { PageHeader } from '../components/PageHeader';
import type { BookCardData } from '../components/BookCard';
import { librariesAtom, userSettingsAtom } from '../store/atoms';
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
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const setLibraries = useSetAtom(librariesAtom);
  const userSettings = useAtomValue(userSettingsAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;

  const loadBooks = useCallback(async () => {
    if (!id) return;
    setLoadingBooks(true);
    try {
      const res = await api.get<BookCardData[]>(
        `/books?libraryId=${id}&limit=200&sortBy=title&order=asc`,
      );
      setBooks(res.data);
    } finally {
      setLoadingBooks(false);
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
        />
      )}

      <BookGrid
        books={books}
        loading={loadingBooks}
        minWidth={minWidth}
        skeletonCount={10}
        emptyMessage="No books in this library yet."
        onBookClick={setSelectedBookId}
      />

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
