import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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
  Group,
} from '@mantine/core';
import { IconBook2, IconFileX } from '@tabler/icons-react';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import type { SmartShelfDetail } from '../types/smartShelf';
import { SMART_SHELF_FIELDS, SMART_SHELF_OPERATORS } from '../types/smartShelf';

interface Book {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
  hasFileMissing: boolean;
}

interface BooksResponse {
  total: number;
  books: Book[];
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
      style={{ cursor: 'pointer' }}
      onClick={onClick}
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

function ruleLabel(field: string, operator: string, value: string): string {
  const fieldLabel =
    SMART_SHELF_FIELDS.find((f) => f.value === field)?.label ?? field;
  const opLabel =
    SMART_SHELF_OPERATORS.find((o) => o.value === operator)?.label ?? operator;
  return `${fieldLabel} ${opLabel} "${value}"`;
}

export function SmartShelfPage() {
  const { id } = useParams<{ id: string }>();
  const [shelf, setShelf] = useState<SmartShelfDetail | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [shelfRes, booksRes] = await Promise.all([
        api.get<SmartShelfDetail>(`/smart-shelves/${id}`),
        api.get<BooksResponse>(`/smart-shelves/${id}/books`),
      ]);
      setShelf(shelfRes.data);
      setBooks(booksRes.data.books);
      setTotal(booksRes.data.total);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Stack>
        <Skeleton height={32} width={200} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 16,
          }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} height={260} radius="md" />
          ))}
        </div>
      </Stack>
    );
  }

  if (!shelf) return null;

  return (
    <>
      <Stack>
        <Box>
          <Title order={2}>{shelf.name}</Title>
          <Group gap={4} mt={4} wrap="wrap">
            {shelf.rules.map((r, i) => (
              <Group key={r.id} gap={4} wrap="nowrap">
                {i > 0 && (
                  <Text size="xs" c="dimmed">
                    {shelf.logic}
                  </Text>
                )}
                <Badge size="xs" variant="outline">
                  {ruleLabel(r.field, r.operator, r.value)}
                </Badge>
              </Group>
            ))}
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {total} book{total !== 1 ? 's' : ''} match
            {total > 500 ? ` (showing first 500)` : ''}
          </Text>
        </Box>

        {books.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">No books match these rules yet.</Text>
          </Center>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 16,
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
      </Stack>

      {selectedBookId && (
        <BookDetailModal
          bookId={selectedBookId}
          onClose={() => setSelectedBookId(null)}
          onBookUpdated={() => void load()}
        />
      )}
    </>
  );
}
