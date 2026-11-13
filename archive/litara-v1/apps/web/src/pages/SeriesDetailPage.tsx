import { useState, useEffect, useCallback } from 'react';
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
  Popover,
  CopyButton,
  Tooltip,
  Switch,
} from '@mantine/core';
import { pushToast } from '../utils/toast';
import {
  IconBook2,
  IconCalendar,
  IconBooks,
  IconFileText,
  IconBuildingStore,
  IconChevronLeft,
  IconChevronRight,
  IconUser,
  IconRefresh,
  IconCopy,
  IconCheck,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import type { AuthorDetail } from '../components/AuthorDetailPage.types';

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

interface SeriesSlotItem {
  id: string;
  title: string;
  sequence: number | null;
  authors: string[];
  hasCover: boolean;
}

interface SeriesDetail {
  id: string;
  name: string;
  totalBooks: number | null;
  authors: SeriesAuthorItem[];
  books: SeriesBookItem[];
  slots: SeriesSlotItem[];
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
  const navigate = useNavigate();
  const location = useLocation();

  function goToAuthor() {
    navigate(`/authors/${author.id}`, { state: { from: location.pathname } });
  }

  return (
    <Group align="flex-start" gap="md" wrap="nowrap">
      <UnstyledButton onClick={goToAuthor} style={{ flexShrink: 0 }}>
        {author.hasCover ? (
          <img
            src={`/api/v1/authors/${author.id}/photo`}
            alt={author.name}
            style={{
              width: PHOTO_SIZE,
              height: PHOTO_SIZE,
              objectFit: 'cover',
              borderRadius: 'var(--mantine-radius-md)',
            }}
          />
        ) : (
          <Avatar size={PHOTO_SIZE} radius="md" color="gray">
            <IconUser size={40} />
          </Avatar>
        )}
      </UnstyledButton>
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Anchor
          component="button"
          fw={600}
          onClick={goToAuthor}
          style={{ textAlign: 'left' }}
        >
          {author.name}
        </Anchor>
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

// ── Slot card (ghost — not in library) ────────────────────────────────────────

function SlotCard({ slot }: { slot: SeriesSlotItem }) {
  const [opened, setOpened] = useState(false);
  const [imgError, setImgError] = useState(false);
  const showCover = slot.hasCover && !imgError;
  const copyText = `${slot.title}${slot.authors.length ? ` by ${slot.authors.join(', ')}` : ''}`;

  return (
    <Popover
      opened={opened}
      onClose={() => setOpened(false)}
      position="top"
      withArrow
      shadow="md"
      width={220}
    >
      <Popover.Target>
        <UnstyledButton
          onClick={() => setOpened((o) => !o)}
          style={{
            width: CARD_W,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '8px 4px',
            borderRadius: 'var(--mantine-radius-sm)',
            opacity: 0.55,
            filter: 'saturate(0.3)',
          }}
        >
          <Box
            style={{
              position: 'relative',
              width: CARD_W - 16,
              height: COVER_H,
            }}
          >
            {showCover ? (
              <img
                src={`/api/v1/series/slots/${slot.id}/cover`}
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
            <Badge
              size="xs"
              color="gray"
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                opacity: 0.9,
                fontSize: 9,
              }}
            >
              Not in library
            </Badge>
            {slot.sequence != null && (
              <Badge
                size="xs"
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: 6,
                  opacity: 0.9,
                }}
              >
                #{slot.sequence}
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
            {slot.title}
          </Text>
        </UnstyledButton>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={600} lineClamp={3}>
            {slot.title}
          </Text>
          {slot.authors.length > 0 && (
            <Text size="xs" c="dimmed">
              {slot.authors.join(', ')}
            </Text>
          )}
          <CopyButton value={copyText} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip
                label={copied ? 'Copied!' : 'Copy title & author'}
                withArrow
              >
                <Button
                  size="xs"
                  variant="light"
                  color={copied ? 'teal' : 'blue'}
                  leftSection={
                    copied ? <IconCheck size={14} /> : <IconCopy size={14} />
                  }
                  onClick={() => {
                    copy();
                    setOpened(false);
                  }}
                  fullWidth
                >
                  {copied ? 'Copied!' : 'Copy title & author'}
                </Button>
              </Tooltip>
            )}
          </CopyButton>
        </Stack>
      </Popover.Dropdown>
    </Popover>
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
  const [enriching, setEnriching] = useState(false);
  const [libraryOnly, setLibraryOnly] = useState(false);

  const loadDetail = useCallback(() => {
    if (!seriesId) return;
    setLoading(true);
    api
      .get<SeriesDetail>(`/series/${seriesId}`)
      .then((res) => setDetail(res.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [seriesId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

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

  const handleEnrich = async () => {
    if (!seriesId) return;
    setEnriching(true);
    try {
      await api.post(`/series/${seriesId}/enrich`);
      loadDetail();
    } catch {
      pushToast(
        'Could not fetch series data from the metadata provider. Check that Hardcover is configured or that a book in this series has a Goodreads ID.',
        { title: 'Enrichment failed', color: 'red' },
      );
    } finally {
      setEnriching(false);
    }
  };

  // ── derived stats ──────────────────────────────────────────────────────────
  const stats = (() => {
    if (!detail) return null;
    const { books, slots, totalBooks } = detail;

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
    const totalCount = totalBooks ?? ownedCount + slots.length;
    const bookCount =
      totalBooks != null || slots.length > 0
        ? `${ownedCount} / ${totalCount}`
        : String(ownedCount);

    return { yearRange, totalPages, publishers, formats, bookCount };
  })();

  // Merge owned books + slots into one sorted strip
  type StripItem =
    | { kind: 'book'; data: SeriesBookItem }
    | { kind: 'slot'; data: SeriesSlotItem };

  const stripItems: StripItem[] = detail
    ? [
        ...detail.books.map((b): StripItem => ({ kind: 'book', data: b })),
        ...(libraryOnly
          ? []
          : detail.slots.map((s): StripItem => ({ kind: 'slot', data: s }))),
      ].sort((a, b) => {
        const seqA = a.data.sequence ?? Infinity;
        const seqB = b.data.sequence ?? Infinity;
        return seqA - seqB;
      })
    : [];

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
        <Group justify="space-between">
          <Button
            leftSection={<IconChevronLeft size={16} />}
            variant="subtle"
            size="sm"
            onClick={() => navigate(from)}
          >
            Back
          </Button>
          <Group gap="md">
            <Switch
              label="Library only"
              size="sm"
              checked={libraryOnly}
              onChange={(e) => setLibraryOnly(e.currentTarget.checked)}
            />
            <Button
              leftSection={<IconRefresh size={16} />}
              variant="subtle"
              size="sm"
              loading={enriching}
              onClick={handleEnrich}
            >
              Fetch Complete Series
            </Button>
          </Group>
        </Group>
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
          <Box
            style={{
              flexShrink: 0,
              overflowX: 'auto',
              overflowY: 'hidden',
            }}
          >
            <Box
              px="md"
              py="sm"
              style={{ display: 'flex', gap: 8, flexWrap: 'nowrap' }}
            >
              {stripItems.map((item) =>
                item.kind === 'book' ? (
                  <BookCard
                    key={item.data.id}
                    book={item.data}
                    onClick={() =>
                      navigate(`/books/${item.data.id}`, {
                        state: { from: location.pathname },
                      })
                    }
                  />
                ) : (
                  <SlotCard key={item.data.id} slot={item.data} />
                ),
              )}
            </Box>
          </Box>
        </>
      )}
    </Paper>
  );
}
