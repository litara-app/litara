import { useState, useEffect, useCallback } from 'react';
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
import { useSetAtom, useAtomValue } from 'jotai';
import { api } from '../utils/api';
import { shelvesAtom, userSettingsAtom } from '../store/atoms';
import type { Shelf } from '../store/atoms';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import type { BookCardData } from '../components/BookCard';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';

export function ShelfPage() {
  const { id } = useParams<{ id: string }>();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loadingShelf, setLoadingShelf] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
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

  async function handleSave() {
    if (!shelf || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await api.patch<Shelf>(`/shelves/${shelf.id}`, {
        name: editName.trim(),
      });
      setShelf(res.data);
      setEditing(false);
      setShelves((prev) =>
        prev.map((s) => (s.id === res.data.id ? res.data : s)),
      );
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditName(shelf?.name ?? '');
    setEditing(false);
  }

  return (
    <Stack>
      <Group align="center" gap="xs">
        {loadingShelf ? (
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
            <Title order={2}>{shelf?.name}</Title>
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
        skeletonCount={5}
        emptyMessage="No books on this shelf yet."
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
