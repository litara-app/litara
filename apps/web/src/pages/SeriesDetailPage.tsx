import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Paper,
  Box,
  Title,
  Text,
  Group,
  Badge,
  Button,
  Loader,
  Center,
  SimpleGrid,
  Divider,
  ScrollArea,
  UnstyledButton,
  Avatar,
  ActionIcon,
  Anchor,
  Stack,
} from '@mantine/core';
import {
  IconBook2,
  IconCalendar,
  IconBooks,
  IconFileText,
  IconBuildingStore,
  IconChevronLeft,
  IconChevronRight,
  IconUser,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import type { AuthorDetail } from '../components/AuthorDetailModal.types';

interface SeriesAuthorItem {
  id: string;
  name: string;
}

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
  authors: SeriesAuthorItem[];
  books: SeriesBookItem[];
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

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

// ── Author panel ──────────────────────────────────────────────────────────────

const PHOTO_SIZE = 100;

function AuthorPanel({ author }: { author: AuthorDetail }) {
  return (
    <Group align="flex-start" gap="md" wrap="nowrap">
      {author.hasCover ? (
        <img
          src={`/api/v1/authors/${author.id}/photo`}
          alt={author.name}
          style={{
            width: PHOTO_SIZE,
            height: PHOTO_SIZE,
            objectFit: 'cover',
            borderRadius: 'var(--mantine-radius-md)',
            flexShrink: 0,
          }}
        />
      ) : (
        <Avatar
          size={PHOTO_SIZE}
          radius="md"
          color="gray"
          style={{ flexShrink: 0 }}
        >
          <IconUser size={40} />
        </Avatar>
      )}
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600}>{author.name}</Text>
        <Text
          size="sm"
          c={author.biography ? undefined : 'dimmed'}
          lineClamp={4}
        >
          {author.biography ?? 'No biography available.'}
        </Text>
        {author.goodreadsId && (
          <Anchor
            href={`https://www.goodreads.com/author/show/${author.goodreadsId}`}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
          >
            View on Goodreads
          </Anchor>
        )}
      </Stack>
    </Group>
  );
}

// ── Book card ─────────────────────────────────────────────────────────────────

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
            style={{ position: 'absolute', bottom: 6, left: 6, opacity: 0.9 }}
          >
            #{book.sequence}
          </Badge>
        )}
      </Box>

      <Text
        size="xs"
        fw={500}
        ta="center"
        lineClamp={2}
        style={{ width: '100%' }}
      >
        {book.title}
      </Text>

      {year != null && (
        <Text size="xs" c="dimmed">
          {year}
        </Text>
      )}
    </UnstyledButton>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SeriesDetailPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from: string =
    (location.state as { from?: string } | null)?.from ?? '/series';

  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorDetails, setAuthorDetails] = useState<AuthorDetail[]>([]);
  const [authorIndex, setAuthorIndex] = useState(0);

  useEffect(() => {
    if (!seriesId) return;
    api
      .get<SeriesDetail>(`/series/${seriesId}`)
      .then((res) => setDetail(res.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [seriesId]);

  useEffect(() => {
    if (!detail) return;
    Promise.all(
      detail.authors.map((a) =>
        api
          .get<AuthorDetail>(`/authors/${a.id}`)
          .then((r) => r.data)
          .catch(() => null),
      ),
    ).then((results) => {
      setAuthorIndex(0);
      setAuthorDetails(results.filter((r): r is AuthorDetail => r !== null));
    });
  }, [detail]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      navigate(from);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [navigate, from]);

  // ── derived stats ──────────────────────────────────────────────────────────
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

  const currentAuthor =
    authorDetails.length > 0 ? authorDetails[authorIndex] : null;

  return (
    <Paper
      withBorder
      radius="md"
      style={{
        height:
          'calc(100dvh - var(--app-shell-header-height) - var(--app-shell-padding) * 2)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── back bar ────────────────────────────────────────────────────── */}
      <Box
        px="md"
        py="xs"
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Button
          leftSection={<IconChevronLeft size={16} />}
          variant="subtle"
          size="sm"
          onClick={() => navigate(from)}
        >
          Back
        </Button>
      </Box>

      {loading && (
        <Center style={{ flex: 1 }}>
          <Loader />
        </Center>
      )}

      {!loading && detail && stats && (
        <>
          {/* ── scrollable body ─────────────────────────────────────────── */}
          <ScrollArea style={{ flex: 1 }} p="xl">
            {/* Series title */}
            <Title order={2} mb={2}>
              {detail.name}
            </Title>
            {detail.authors.length > 0 && (
              <Text size="sm" c="dimmed" mb="xl">
                {detail.authors.map((a) => a.name).join(' · ')}
              </Text>
            )}

            {/* Author section */}
            {authorDetails.length > 0 && currentAuthor && (
              <Box mb="xl">
                <Group justify="space-between" align="center" mb="sm">
                  <Text
                    fw={600}
                    size="sm"
                    c="dimmed"
                    style={{
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {authorDetails.length > 1 ? 'Authors' : 'Author'}
                  </Text>
                  {authorDetails.length > 1 && (
                    <Group gap={4}>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() =>
                          setAuthorIndex((i) =>
                            i === 0 ? authorDetails.length - 1 : i - 1,
                          )
                        }
                        disabled={authorDetails.length <= 1}
                        aria-label="Previous author"
                      >
                        <IconChevronLeft size={16} />
                      </ActionIcon>
                      <Text size="xs" c="dimmed">
                        {authorIndex + 1} / {authorDetails.length}
                      </Text>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() =>
                          setAuthorIndex((i) =>
                            i === authorDetails.length - 1 ? 0 : i + 1,
                          )
                        }
                        disabled={authorDetails.length <= 1}
                        aria-label="Next author"
                      >
                        <IconChevronRight size={16} />
                      </ActionIcon>
                    </Group>
                  )}
                </Group>
                <AuthorPanel author={currentAuthor} />
              </Box>
            )}

            {/* Stat tiles */}
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

          {/* ── book strip (fixed at bottom) ──────────────────────────── */}
          <Divider />
          <Box style={{ flexShrink: 0 }}>
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
                    onClick={() =>
                      navigate(`/books/${book.id}`, {
                        state: { from: location.pathname },
                      })
                    }
                  />
                ))}
              </Box>
            </ScrollArea>
          </Box>
        </>
      )}
    </Paper>
  );
}
