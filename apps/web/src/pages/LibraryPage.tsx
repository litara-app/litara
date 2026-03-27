import { useState, useEffect, useCallback } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import {
  Title,
  Group,
  ActionIcon,
  TextInput,
  Stack,
  Skeleton,
} from '@mantine/core';
import { IconPencil, IconCheck, IconX } from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import type { BookCardData } from '../components/BookCard';
import { librariesAtom, userSettingsAtom } from '../store/atoms';
import type { Library } from '../store/atoms';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const [library, setLibrary] = useState<Library | null>(null);
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loadingLib, setLoadingLib] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
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

  async function handleSave() {
    if (!library || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await api.patch<Library>(`/libraries/${library.id}`, {
        name: editName.trim(),
      });
      setLibrary(res.data);
      setEditing(false);
      setLibraries((prev) =>
        prev.map((l) => (l.id === res.data.id ? res.data : l)),
      );
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditName(library?.name ?? '');
    setEditing(false);
  }

  return (
    <Stack>
      <Group align="center" gap="xs">
        {loadingLib ? (
          <Skeleton height={36} width={200} radius="sm" />
        ) : editing ? (
          <>
            <TextInput
              value={editName}
              onChange={(e) => setEditName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
                if (e.key === 'Escape') cancelEdit();
              }}
              size="md"
              style={{ fontSize: 'var(--mantine-font-size-xl)' }}
              autoFocus
            />
            <ActionIcon
              size="md"
              variant="filled"
              loading={saving}
              onClick={() => void handleSave()}
            >
              <IconCheck size={16} />
            </ActionIcon>
            <ActionIcon size="md" variant="subtle" onClick={cancelEdit}>
              <IconX size={16} />
            </ActionIcon>
          </>
        ) : (
          <>
            <Title order={2}>{library?.name}</Title>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <IconPencil size={16} />
            </ActionIcon>
          </>
        )}
      </Group>

      <BookGrid
        books={books}
        loading={loadingBooks}
        minWidth={minWidth}
        skeletonCount={10}
        emptyMessage="No books in this library yet."
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
