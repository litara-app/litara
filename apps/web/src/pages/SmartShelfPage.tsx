import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Title, Stack, Text, Badge, Box, Group, Skeleton } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { BookGrid } from '../components/BookGrid';
import { PageHeader } from '../components/PageHeader';
import { SmartShelfModal } from '../components/SmartShelfModal';
import type { BookCardData } from '../components/BookCard';
import type { SmartShelfDetail } from '../types/smartShelf';
import { SMART_SHELF_FIELDS, SMART_SHELF_OPERATORS } from '../types/smartShelf';
import { userSettingsAtom, smartShelvesAtom } from '../store/atoms';
import { useSetAtom } from 'jotai';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';
import { pushToast } from '../utils/toast';

interface BooksResponse {
  total: number;
  books: BookCardData[];
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
  const navigate = useNavigate();
  const [shelf, setShelf] = useState<SmartShelfDetail | null>(null);
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const userSettings = useAtomValue(userSettingsAtom);
  const setSmartShelves = useSetAtom(smartShelvesAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;

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

  async function handleDelete() {
    if (!shelf) return;
    await api.delete(`/smart-shelves/${shelf.id}`);
    setSmartShelves((prev) => prev.filter((s) => s.id !== shelf.id));
    pushToast('Smart shelf deleted', { color: 'green' });
    navigate('/');
  }

  if (loading) {
    return (
      <Stack>
        <Skeleton height={32} width={200} />
        <BookGrid
          books={[]}
          loading
          minWidth={minWidth}
          skeletonCount={12}
          onBookClick={() => {}}
        />
      </Stack>
    );
  }

  if (!shelf) return null;

  return (
    <>
      <Stack>
        <PageHeader
          title={<Title order={2}>{shelf.name}</Title>}
          onSettingsClick={() => setSettingsOpen(true)}
        />

        <Box>
          <Group gap={4} wrap="wrap">
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

        <BookGrid
          books={books}
          loading={false}
          minWidth={minWidth}
          skeletonCount={12}
          emptyMessage="No books match these rules yet."
          onBookClick={setSelectedBookId}
        />
      </Stack>

      <SmartShelfModal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          setSettingsOpen(false);
          void load();
        }}
        shelf={shelf}
        onDelete={() => handleDelete()}
      />

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
