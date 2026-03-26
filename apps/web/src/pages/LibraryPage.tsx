import { useState, useEffect, useCallback } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import {
  Title,
  Group,
  ActionIcon,
  TextInput,
  Stack,
  Card,
  AspectRatio,
  Center,
  Text,
  Badge,
  Box,
  Tooltip,
  Skeleton,
} from '@mantine/core';
import {
  IconPencil,
  IconCheck,
  IconX,
  IconBook2,
  IconFileX,
} from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { librariesAtom, userSettingsAtom } from '../store/atoms';
import type { Library } from '../store/atoms';

const ITEM_MIN_WIDTHS: Record<string, number> = {
  sm: 120,
  md: 160,
  lg: 210,
  xl: 260,
};

interface Book {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
  hasFileMissing: boolean;
}

const FORMAT_COLORS: Record<string, string> = {
  EPUB: 'green',
  MOBI: 'blue',
  AZW: 'orange',
  AZW3: 'yellow',
  CBZ: 'violet',
  PDF: 'red',
};

function BookCard({ book, onClick }: { book: Book; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);
  const showCover = book.hasCover && !imgError;

  return (
    <Card
      shadow="sm"
      padding="sm"
      radius="md"
      withBorder
      className="book-card"
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <Box mb="sm" style={{ position: 'relative' }}>
        <AspectRatio ratio={2 / 3}>
          {showCover ? (
            <img
              src={`/api/v1/books/${book.id}/cover?v=${book.coverUpdatedAt}`}
              alt={book.title}
              style={{
                objectFit: 'cover',
                borderRadius: 4,
                width: '100%',
                height: '100%',
              }}
              onError={() => setImgError(true)}
            />
          ) : (
            <Center
              style={{
                background: 'var(--mantine-color-gray-1)',
                borderRadius: 4,
                width: '100%',
                height: '100%',
              }}
            >
              <IconBook2 size={36} color="var(--mantine-color-gray-5)" />
            </Center>
          )}
        </AspectRatio>
        <Box
          style={{
            position: 'absolute',
            top: 6,
            left: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {book.formats.map((fmt) => (
            <Badge
              key={fmt}
              size="xs"
              color={FORMAT_COLORS[fmt] ?? 'gray'}
              radius="sm"
              style={{
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                paddingLeft: 4,
                paddingRight: 6,
              }}
            >
              {fmt}
            </Badge>
          ))}
        </Box>
        {book.hasFileMissing && (
          <Box style={{ position: 'absolute', top: 6, right: 0 }}>
            <Tooltip label="File missing from disk">
              <Badge
                size="xs"
                color="red"
                radius="sm"
                leftSection={<IconFileX size={10} />}
                style={{
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                  paddingRight: 4,
                  paddingLeft: 6,
                }}
              >
                Missing
              </Badge>
            </Tooltip>
          </Box>
        )}
      </Box>
      <Text fw={500} size="sm" lineClamp={2}>
        {book.title}
      </Text>
      <Text size="xs" c="dimmed" mt={4}>
        {book.authors.join(', ') || 'Unknown'}
      </Text>
    </Card>
  );
}

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const [library, setLibrary] = useState<Library | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
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
      const res = await api.get<Book[]>(
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

      {loadingBooks ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
            gap: '16px',
          }}
        >
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} height={200} radius="md" />
          ))}
        </div>
      ) : books.length === 0 ? (
        <Text c="dimmed" size="sm">
          No books in this library yet.
        </Text>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
            gap: '16px',
          }}
        >
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => setSelectedBookId(book.id)}
            />
          ))}
        </div>
      )}

      <BookDetailModal
        bookId={selectedBookId}
        onClose={() => setSelectedBookId(null)}
        onBookUpdated={() => void loadBooks()}
      />
    </Stack>
  );
}
