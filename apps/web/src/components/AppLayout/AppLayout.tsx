import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AppShell,
  Alert,
  Burger,
  Button,
  Group,
  Title,
  UnstyledButton,
  Text,
  Box,
  ActionIcon,
  Tooltip,
  Kbd,
} from '@mantine/core';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet } from 'react-router-dom';
import {
  IconSearch,
  IconBook2,
  IconServerOff,
  IconSun,
  IconMoon,
  IconExternalLink,
  IconBrandGithub,
  IconUser,
  IconBooks,
} from '@tabler/icons-react';
import { Spotlight, spotlight } from '@mantine/spotlight';
import { useSetAtom, useAtomValue } from 'jotai';
import { NavbarContent } from './NavbarContent';
import { BulkActionBar } from '../BulkActionBar';
import { PersistentAudiobookPlayer, PLAYER_HEIGHT } from '../AudiobookPlayer';
import { api } from '../../utils/api';
import {
  userSettingsAtom,
  DEFAULT_USER_SETTINGS,
  backendStatusAtom,
  selectedBookIdsAtom,
  audiobookPlayerAtom,
} from '../../store/atoms';

type SearchType = 'all' | 'books' | 'authors' | 'series';

interface SearchBook {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt: string;
  seriesName: string | null;
  seriesPosition: number | null;
  publishedDate: string | null;
}

interface SearchAuthor {
  id: string;
  name: string;
  hasCover: boolean;
  bookCount: number;
}

interface SearchSeries {
  id: string;
  name: string;
  ownedCount: number;
  totalBooks: number | null;
  coverBooks: Array<{ id: string; coverUpdatedAt: string }>;
  authors: string[];
}

function SearchBookItem({ book }: { book: SearchBook }) {
  const year = book.publishedDate
    ? new Date(book.publishedDate).getFullYear()
    : null;
  const seriesMeta = book.seriesName
    ? [
        book.seriesName +
          (book.seriesPosition != null ? ` #${book.seriesPosition}` : ''),
        year,
      ]
        .filter(Boolean)
        .join('  •  ')
    : (year?.toString() ?? null);

  return (
    <Group wrap="nowrap" gap="sm" p="xs" style={{ alignItems: 'center' }}>
      <Box
        style={{
          width: 32,
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {book.hasCover ? (
          <img
            src={`/api/v1/books/${book.id}/cover?v=${book.coverUpdatedAt}`}
            alt=""
            style={{
              width: 32,
              height: 48,
              objectFit: 'cover',
              borderRadius: 2,
            }}
          />
        ) : (
          <IconBook2 size={24} style={{ opacity: 0.4 }} />
        )}
      </Box>
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" fw={500} lineClamp={1}>
          {book.title}
        </Text>
        {book.authors.length > 0 && (
          <Text
            size="xs"
            style={{ color: 'inherit', opacity: 0.65 }}
            lineClamp={1}
          >
            {book.authors.join(', ')}
          </Text>
        )}
        {seriesMeta && (
          <Text
            size="xs"
            style={{ color: 'inherit', opacity: 0.65 }}
            lineClamp={1}
          >
            {seriesMeta}
          </Text>
        )}
      </Box>
    </Group>
  );
}

function SearchAuthorItem({ author }: { author: SearchAuthor }) {
  return (
    <Group wrap="nowrap" gap="sm" p="xs" style={{ alignItems: 'center' }}>
      <Box
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--mantine-color-default-border)',
        }}
      >
        {author.hasCover ? (
          <img
            src={`/api/v1/authors/${author.id}/photo`}
            alt=""
            style={{ width: 32, height: 32, objectFit: 'cover' }}
          />
        ) : (
          <IconUser size={18} style={{ opacity: 0.5 }} />
        )}
      </Box>
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" fw={500} lineClamp={1}>
          {author.name}
        </Text>
        <Text size="xs" style={{ color: 'inherit', opacity: 0.65 }}>
          {author.bookCount} {author.bookCount === 1 ? 'book' : 'books'}
        </Text>
      </Box>
    </Group>
  );
}

function SearchSeriesItem({ series }: { series: SearchSeries }) {
  const firstCover = series.coverBooks[0];
  const countLabel =
    series.totalBooks != null
      ? `${series.ownedCount} / ${series.totalBooks} books`
      : `${series.ownedCount} ${series.ownedCount === 1 ? 'book' : 'books'}`;

  return (
    <Group wrap="nowrap" gap="sm" p="xs" style={{ alignItems: 'center' }}>
      <Box
        style={{
          width: 32,
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {firstCover ? (
          <img
            src={`/api/v1/books/${firstCover.id}/cover?v=${firstCover.coverUpdatedAt}`}
            alt=""
            style={{
              width: 32,
              height: 48,
              objectFit: 'cover',
              borderRadius: 2,
            }}
          />
        ) : (
          <IconBooks size={24} style={{ opacity: 0.4 }} />
        )}
      </Box>
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" fw={500} lineClamp={1}>
          {series.name}
        </Text>
        {series.authors.length > 0 && (
          <Text
            size="xs"
            style={{ color: 'inherit', opacity: 0.65 }}
            lineClamp={1}
          >
            {series.authors.join(', ')}
          </Text>
        )}
        <Text size="xs" style={{ color: 'inherit', opacity: 0.65 }}>
          {countLabel}
        </Text>
      </Box>
    </Group>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const [opened, { toggle, close }] = useDisclosure(
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );
  const [spotlightQuery, setSpotlightQuery] = useState('');
  const [bookResults, setBookResults] = useState<SearchBook[]>([]);
  const [authorResults, setAuthorResults] = useState<SearchAuthor[]>([]);
  const [seriesResults, setSeriesResults] = useState<SearchSeries[]>([]);
  const [searchType, setSearchType] = useState<SearchType>('all');
  const [shelfmarkUrl, setShelfmarkUrl] = useState<string | null>(null);
  const setUserSettings = useSetAtom(userSettingsAtom);
  const backendStatus = useAtomValue(backendStatusAtom);
  const setSelectedBookIds = useSetAtom(selectedBookIdsAtom);
  const playerState = useAtomValue(audiobookPlayerAtom);
  const location = useLocation();

  useEffect(() => {
    setSelectedBookIds(new Set());
  }, [location.pathname, setSelectedBookIds]);

  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light');

  const isMac =
    typeof navigator !== 'undefined' &&
    /mac/i.test(navigator.platform ?? navigator.userAgent);

  useEffect(() => {
    void Promise.all([
      api
        .get('/users/me/settings')
        .then((res) => {
          setUserSettings({
            dashboardLayout:
              res.data.dashboardLayout ?? DEFAULT_USER_SETTINGS.dashboardLayout,
            bookItemSize: res.data.bookItemSize ?? 'md',
            progressDisplaySource: res.data.progressDisplaySource ?? 'HIGHEST',
          });
        })
        .catch(() => {}),
      api
        .get<{ shelfmarkUrl: string | null }>('/admin/settings/shelfmark')
        .then((r) => setShelfmarkUrl(r.data.shelfmarkUrl))
        .catch(() => {}),
    ]);
  }, [setUserSettings]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (spotlightQuery.length < 2) {
        setBookResults([]);
        setAuthorResults([]);
        setSeriesResults([]);
        return;
      }
      try {
        if (searchType === 'all') {
          const booksParams = new URLSearchParams({
            q: spotlightQuery,
            limit: '4',
            searchBy: 'title',
          });
          const authorsParams = new URLSearchParams({ q: spotlightQuery });
          const seriesParams = new URLSearchParams({ q: spotlightQuery });
          const [booksRes, authorsRes, seriesRes] = await Promise.all([
            api.get<SearchBook[]>(`/books?${booksParams.toString()}`),
            api.get<SearchAuthor[]>(`/authors?${authorsParams.toString()}`),
            api.get<SearchSeries[]>(`/series?${seriesParams.toString()}`),
          ]);
          setBookResults(booksRes.data);
          setAuthorResults(authorsRes.data.slice(0, 3));
          setSeriesResults(seriesRes.data.slice(0, 3));
        } else if (searchType === 'books') {
          const params = new URLSearchParams({
            q: spotlightQuery,
            limit: '8',
            searchBy: 'title',
          });
          const res = await api.get<SearchBook[]>(
            `/books?${params.toString()}`,
          );
          setBookResults(res.data);
          setAuthorResults([]);
          setSeriesResults([]);
        } else if (searchType === 'authors') {
          const params = new URLSearchParams({ q: spotlightQuery });
          const res = await api.get<SearchAuthor[]>(
            `/authors?${params.toString()}`,
          );
          setBookResults([]);
          setAuthorResults(res.data.slice(0, 8));
          setSeriesResults([]);
        } else {
          const params = new URLSearchParams({ q: spotlightQuery });
          const res = await api.get<SearchSeries[]>(
            `/series?${params.toString()}`,
          );
          setBookResults([]);
          setAuthorResults([]);
          setSeriesResults(res.data.slice(0, 8));
        }
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(t);
  }, [spotlightQuery, searchType]);

  function closeSpotlight() {
    spotlight.close();
    setSpotlightQuery('');
    setBookResults([]);
    setAuthorResults([]);
    setSeriesResults([]);
  }

  function handleSelectBook(bookId: string) {
    navigate(`/books/${bookId}`, { state: { from: location.pathname } });
    closeSpotlight();
  }

  function handleSelectAuthor(authorId: string) {
    navigate(`/authors/${authorId}`);
    closeSpotlight();
  }

  function handleSelectSeries(seriesId: string) {
    navigate(`/series/${seriesId}`);
    closeSpotlight();
  }

  const searchTypeOptions: { label: string; value: SearchType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Books', value: 'books' },
    { label: 'Authors', value: 'authors' },
    { label: 'Series', value: 'series' },
  ];

  return (
    <>
      <AppShell
        header={{ height: 56 }}
        navbar={{
          width: 260,
          breakpoint: 'sm',
          collapsed: { desktop: !opened, mobile: !opened },
        }}
        footer={playerState ? { height: PLAYER_HEIGHT } : undefined}
        padding="md"
      >
        <AppShell.Header>
          <Box
            h="100%"
            px="md"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: 'var(--mantine-spacing-md)',
            }}
          >
            <Group gap="md" wrap="nowrap">
              <Burger opened={opened} onClick={toggle} size="sm" />
              <Group gap="xs" wrap="nowrap">
                <img src="/logo.svg" alt="Litara logo" width={28} height={28} />
                <Title order={4} style={{ whiteSpace: 'nowrap' }}>
                  Litara
                </Title>
              </Group>
            </Group>

            <UnstyledButton
              visibleFrom="sm"
              onClick={() => spotlight.open()}
              style={{
                width: 360,
                height: 36,
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-sm)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 10px',
                gap: 8,
                backgroundColor: 'var(--mantine-color-default)',
                cursor: 'text',
              }}
            >
              <IconSearch size={16} color="var(--mantine-color-placeholder)" />
              <Text
                size="sm"
                c="placeholder"
                style={{ flex: 1, userSelect: 'none' }}
              >
                Search...
              </Text>
              <Group gap={4} wrap="nowrap">
                <Kbd size="xs">{isMac ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd size="xs">K</Kbd>
              </Group>
            </UnstyledButton>

            <Group justify="flex-end" gap="xs">
              <ActionIcon
                hiddenFrom="sm"
                variant="subtle"
                size="lg"
                onClick={() => spotlight.open()}
                aria-label="Search"
              >
                <IconSearch size={18} />
              </ActionIcon>
              {shelfmarkUrl && (
                <Button
                  visibleFrom="sm"
                  component="a"
                  href={shelfmarkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="subtle"
                  size="sm"
                  rightSection={<IconExternalLink size={14} />}
                >
                  Shelfmark
                </Button>
              )}
              <Tooltip label="Docs" position="bottom-end">
                <ActionIcon
                  visibleFrom="sm"
                  variant="subtle"
                  size="lg"
                  component="a"
                  href="https://litara-app.github.io/litara/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconBook2 size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="GitHub" position="bottom-end">
                <ActionIcon
                  visibleFrom="sm"
                  variant="subtle"
                  size="lg"
                  component="a"
                  href="https://github.com/litara-app/litara"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconBrandGithub size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip
                label={
                  computedColorScheme === 'dark' ? 'Light mode' : 'Dark mode'
                }
                position="bottom-end"
              >
                <ActionIcon
                  variant="subtle"
                  size="lg"
                  onClick={() =>
                    setColorScheme(
                      computedColorScheme === 'dark' ? 'light' : 'dark',
                    )
                  }
                >
                  {computedColorScheme === 'dark' ? (
                    <IconSun size={18} />
                  ) : (
                    <IconMoon size={18} />
                  )}
                </ActionIcon>
              </Tooltip>
            </Group>
          </Box>
        </AppShell.Header>

        <AppShell.Navbar>
          <NavbarContent
            onNavigate={() => {
              if (window.innerWidth < 768) close();
            }}
          />
        </AppShell.Navbar>

        <AppShell.Main className="dot-matrix-bg">
          {backendStatus === 'error' && (
            <Alert
              icon={<IconServerOff size={16} />}
              color="red"
              mb="md"
              title="Cannot reach server"
            >
              The backend is not responding. Check that the API and database are
              running.
            </Alert>
          )}
          <Outlet />
        </AppShell.Main>

        {playerState && (
          <AppShell.Footer>
            <PersistentAudiobookPlayer key={playerState.bookId} />
          </AppShell.Footer>
        )}

        <BulkActionBar />
      </AppShell>

      <Spotlight.Root
        shortcut={['mod + K']}
        onQueryChange={setSpotlightQuery}
        scrollable
        maxHeight={520}
      >
        <Spotlight.Search
          placeholder="Search..."
          leftSection={<IconSearch size={16} />}
        />
        <Box px="sm" py="xs">
          <Button.Group>
            {searchTypeOptions.map(({ label, value }) => (
              <Button
                key={value}
                size="xs"
                variant={searchType === value ? 'filled' : 'default'}
                onClick={() => setSearchType(value)}
                style={{ flex: 1 }}
              >
                {label}
              </Button>
            ))}
          </Button.Group>
        </Box>
        <Spotlight.ActionsList>
          {spotlightQuery.length >= 2 ? (
            (() => {
              const hasBooks = bookResults.length > 0;
              const hasAuthors = authorResults.length > 0;
              const hasSeries = seriesResults.length > 0;
              const hasAny = hasBooks || hasAuthors || hasSeries;

              if (!hasAny) {
                return <Spotlight.Empty>No results found</Spotlight.Empty>;
              }

              const showSectionLabels =
                searchType === 'all' &&
                (hasBooks ? 1 : 0) +
                  (hasAuthors ? 1 : 0) +
                  (hasSeries ? 1 : 0) >
                  1;

              return (
                <>
                  {hasBooks && (
                    <>
                      {showSectionLabels && (
                        <Text
                          size="xs"
                          fw={600}
                          px="sm"
                          pt="xs"
                          pb={2}
                          c="dimmed"
                          tt="uppercase"
                        >
                          Books
                        </Text>
                      )}
                      {bookResults.map((book) => (
                        <Spotlight.Action
                          key={book.id}
                          onClick={() => handleSelectBook(book.id)}
                          p={0}
                        >
                          <SearchBookItem book={book} />
                        </Spotlight.Action>
                      ))}
                    </>
                  )}
                  {hasAuthors && (
                    <>
                      {showSectionLabels && (
                        <Text
                          size="xs"
                          fw={600}
                          px="sm"
                          pt="xs"
                          pb={2}
                          c="dimmed"
                          tt="uppercase"
                        >
                          Authors
                        </Text>
                      )}
                      {authorResults.map((author) => (
                        <Spotlight.Action
                          key={author.id}
                          onClick={() => handleSelectAuthor(author.id)}
                          p={0}
                        >
                          <SearchAuthorItem author={author} />
                        </Spotlight.Action>
                      ))}
                    </>
                  )}
                  {hasSeries && (
                    <>
                      {showSectionLabels && (
                        <Text
                          size="xs"
                          fw={600}
                          px="sm"
                          pt="xs"
                          pb={2}
                          c="dimmed"
                          tt="uppercase"
                        >
                          Series
                        </Text>
                      )}
                      {seriesResults.map((series) => (
                        <Spotlight.Action
                          key={series.id}
                          onClick={() => handleSelectSeries(series.id)}
                          p={0}
                        >
                          <SearchSeriesItem series={series} />
                        </Spotlight.Action>
                      ))}
                    </>
                  )}
                </>
              );
            })()
          ) : (
            <Spotlight.Empty>
              Type at least 2 characters to search
            </Spotlight.Empty>
          )}
        </Spotlight.ActionsList>
      </Spotlight.Root>
    </>
  );
}
