import { useState, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import {
  Title,
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
import { IconBook2, IconFileX } from '@tabler/icons-react';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { userSettingsAtom } from '../store/atoms';

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
              src={`/api/v1/books/${book.id}/cover`}
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

export function AllBooksPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const userSettings = useAtomValue(userSettingsAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Book[]>(
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

  return (
    <Stack>
      <Title order={2}>All Books</Title>

      {loading ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
            gap: '16px',
          }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} height={200} radius="md" />
          ))}
        </div>
      ) : books.length === 0 ? (
        <Text c="dimmed" size="sm">
          No books found. Add a watched folder in Settings to start importing.
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
