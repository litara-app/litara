import { useState, useEffect } from 'react';
import {
  Modal,
  Text,
  Group,
  Badge,
  Box,
  ScrollArea,
  UnstyledButton,
  Loader,
  Center,
  SimpleGrid,
  Divider,
  Title,
} from '@mantine/core';
import {
  IconBook2,
  IconCalendar,
  IconBooks,
  IconFileText,
  IconBuildingStore,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import { BookDetailModal } from './BookDetailModal';

interface SeriesBookItem {
  id: string;
  title: string;
  sequence: number | null;
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
  publishedDate: string | null;
  pageCount: number | null;
  publisher: string | null;
}

interface SeriesDetail {
  id: string;
  name: string;
  totalBooks: number | null;
  authors: string[];
  books: SeriesBookItem[];
}

// ── stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Box
      p="md"
      style={{
        background: 'var(--mantine-color-default)',
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
        textAlign: 'center',
      }}
    >
      <Center mb={6}>{icon}</Center>
      <Text size="xl" fw={700} lh={1}>
        {value}
      </Text>
      <Text size="xs" c="dimmed" mt={4}>
        {label}
      </Text>
    </Box>
  );
}

// ── book card (horizontal strip) ─────────────────────────────────────────────

const CARD_W = 130;
const COVER_H = 180;

function BookCard({
  book,
  onClick,
}: {
  book: SeriesBookItem;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showCover = book.hasCover && !imgError;
  const year = book.publishedDate
    ? new Date(book.publishedDate).getUTCFullYear()
    : null;

  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        width: CARD_W,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '8px 4px',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
    >
      {/* cover */}
      <Box
        style={{ position: 'relative', width: CARD_W - 16, height: COVER_H }}
      >
        {showCover ? (
          <img
            src={`/api/v1/books/${book.id}/cover?v=${book.coverUpdatedAt}`}
            alt=""
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 6,
              display: 'block',
              boxShadow: '0 3px 10px rgba(0,0,0,0.25)',
            }}
          />
        ) : (
          <Box
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--mantine-color-gray-2)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconBook2 size={32} color="var(--mantine-color-dimmed)" />
          </Box>
        )}
        {book.sequence != null && (
          <Badge
            size="xs"
            style={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              opacity: 0.9,
            }}
          >
            #{book.sequence}
          </Badge>
        )}
      </Box>

      {/* title */}
      <Text
        size="xs"
        fw={500}
        ta="center"
        lineClamp={2}
        style={{ width: '100%' }}
      >
        {book.title}
      </Text>

      {/* year */}
      {year != null && (
        <Text size="xs" c="dimmed">
          {year}
        </Text>
      )}
    </UnstyledButton>
  );
}

// ── main component ────────────────────────────────────────────────────────────

interface SeriesDetailModalProps {
  seriesId: string | null;
  onClose: () => void;
}

export function SeriesDetailModal({
  seriesId,
  onClose,
}: SeriesDetailModalProps) {
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);

  useEffect(() => {
    if (!seriesId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return;
    }
    setLoading(true);
    api
      .get<SeriesDetail>(`/series/${seriesId}`)
      .then((res) => setDetail(res.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [seriesId]);

  // ── derived stats ────────────────────────────────────────────────────────
  const stats = (() => {
    if (!detail) return null;
    const { books, totalBooks } = detail;

    const years = books
      .map((b) =>
        b.publishedDate ? new Date(b.publishedDate).getUTCFullYear() : null,
      )
      .filter((y): y is number => y != null);
    const yearRange =
      years.length > 0
        ? years.length === 1 || Math.min(...years) === Math.max(...years)
          ? String(Math.min(...years))
          : `${Math.min(...years)} – ${Math.max(...years)}`
        : null;

    const totalPages = books.reduce(
      (sum, b) => (b.pageCount != null ? sum + b.pageCount : sum),
      0,
    );

    const publishers = [
      ...new Set(books.map((b) => b.publisher).filter(Boolean)),
    ] as string[];

    const formats = [...new Set(books.flatMap((b) => b.formats))];

    const ownedCount = books.length;
    const bookCount =
      totalBooks != null ? `${ownedCount} / ${totalBooks}` : String(ownedCount);

    return { yearRange, totalPages, publishers, formats, bookCount };
  })();

  return (
    <>
      <Modal
        opened={!!seriesId}
        onClose={onClose}
        fullScreen
        padding={0}
        withCloseButton={false}
        styles={{
          body: { height: '100%', display: 'flex', flexDirection: 'column' },
        }}
      >
        {loading && (
          <Center style={{ flex: 1 }}>
            <Loader />
          </Center>
        )}

        {!loading && detail && stats && (
          <>
            {/* ── header ──────────────────────────────────────────────── */}
            <Box
              px="xl"
              py="md"
              style={{
                borderBottom: '1px solid var(--mantine-color-default-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <Box>
                <Title order={2}>{detail.name}</Title>
                {detail.authors.length > 0 && (
                  <Text size="sm" c="dimmed" mt={2}>
                    {detail.authors.join(' · ')}
                  </Text>
                )}
              </Box>
              <UnstyledButton
                onClick={onClose}
                style={{
                  fontSize: 'var(--mantine-font-size-xl)',
                  color: 'var(--mantine-color-dimmed)',
                  lineHeight: 1,
                  padding: '4px 8px',
                }}
                aria-label="Close"
              >
                ✕
              </UnstyledButton>
            </Box>

            {/* ── body (scrollable) ───────────────────────────────────── */}
            <ScrollArea style={{ flex: 1 }} p="xl">
              <SimpleGrid cols={{ base: 2, xs: 2, sm: 4 }} spacing="md" mb="xl">
                <StatTile
                  icon={
                    <IconBooks size={20} color="var(--mantine-color-blue-5)" />
                  }
                  label="Books owned"
                  value={stats.bookCount}
                />
                {stats.yearRange && (
                  <StatTile
                    icon={
                      <IconCalendar
                        size={20}
                        color="var(--mantine-color-green-5)"
                      />
                    }
                    label="Years"
                    value={stats.yearRange}
                  />
                )}
                {stats.totalPages > 0 && (
                  <StatTile
                    icon={
                      <IconFileText
                        size={20}
                        color="var(--mantine-color-orange-5)"
                      />
                    }
                    label="Total pages"
                    value={stats.totalPages.toLocaleString()}
                  />
                )}
                {stats.formats.length > 0 && (
                  <StatTile
                    icon={
                      <IconFileText
                        size={20}
                        color="var(--mantine-color-violet-5)"
                      />
                    }
                    label={stats.formats.length === 1 ? 'Format' : 'Formats'}
                    value={stats.formats.join(' · ')}
                  />
                )}
              </SimpleGrid>

              {stats.publishers.length > 0 && (
                <Group gap="xs" mb="xl" align="center">
                  <IconBuildingStore
                    size={16}
                    color="var(--mantine-color-dimmed)"
                  />
                  <Text size="sm" c="dimmed">
                    {stats.publishers.join(' · ')}
                  </Text>
                </Group>
              )}
            </ScrollArea>

            {/* ── book strip (fixed at bottom) ────────────────────────── */}
            <Divider />
            <Box
              style={{
                flexShrink: 0,
                background: 'var(--mantine-color-body)',
              }}
            >
              <ScrollArea
                type="scroll"
                style={{ width: '100%' }}
                offsetScrollbars
              >
                <Box
                  px="md"
                  py="sm"
                  style={{ display: 'flex', gap: 8, minWidth: 'max-content' }}
                >
                  {detail.books.map((book) => (
                    <BookCard
                      key={book.id}
                      book={book}
                      onClick={() => setActiveBookId(book.id)}
                    />
                  ))}
                </Box>
              </ScrollArea>
            </Box>
          </>
        )}
      </Modal>

      <BookDetailModal
        bookId={activeBookId}
        onClose={() => setActiveBookId(null)}
        onBookUpdated={() => {}}
      />
    </>
  );
}
