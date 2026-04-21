import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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
} from '@tabler/icons-react';
import { Spotlight, spotlight } from '@mantine/spotlight';
import { useSetAtom, useAtomValue } from 'jotai';
import { NavbarContent } from './NavbarContent';
import { BookDetailModal } from '../BookDetailModal';
import { BulkActionBar } from '../BulkActionBar';
import { api } from '../../utils/api';
import {
  userSettingsAtom,
  DEFAULT_USER_SETTINGS,
  backendStatusAtom,
  selectedBookIdsAtom,
} from '../../store/atoms';

type SearchByFilter = 'all' | 'title' | 'author' | 'series';

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

function SearchResultItem({ book }: { book: SearchBook }) {
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

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure(true);
  const [spotlightQuery, setSpotlightQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchBook[]>([]);
  const [searchBy, setSearchBy] = useState<SearchByFilter>('all');
  const [searchBookId, setSearchBookId] = useState<string | null>(null);
  const [shelfmarkUrl, setShelfmarkUrl] = useState<string | null>(null);
  const setUserSettings = useSetAtom(userSettingsAtom);
  const backendStatus = useAtomValue(backendStatusAtom);
  const setSelectedBookIds = useSetAtom(selectedBookIdsAtom);
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
        setSearchResults([]);
        return;
      }
      try {
        const params = new URLSearchParams({
          q: spotlightQuery,
          limit: '8',
        });
        if (searchBy !== 'all') params.set('searchBy', searchBy);
        const res = await api.get<SearchBook[]>(`/books?${params.toString()}`);
        setSearchResults(res.data);
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(t);
  }, [spotlightQuery, searchBy]);

  function handleSelectBook(bookId: string) {
    setSearchBookId(bookId);
    spotlight.close();
    setSpotlightQuery('');
    setSearchResults([]);
  }

  const filterOptions: { label: string; value: SearchByFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Title', value: 'title' },
    { label: 'Author', value: 'author' },
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
                Search books...
              </Text>
              <Group gap={4} wrap="nowrap">
                <Kbd size="xs">{isMac ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd size="xs">K</Kbd>
              </Group>
            </UnstyledButton>

            <Group justify="flex-end" gap="xs">
              {shelfmarkUrl && (
                <Button
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
              <Tooltip label="GitHub" position="bottom-end">
                <ActionIcon
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
          <NavbarContent />
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

        <BulkActionBar />
      </AppShell>

      <Spotlight.Root
        shortcut={['mod + K']}
        onQueryChange={setSpotlightQuery}
        scrollable
        maxHeight={480}
      >
        <Spotlight.Search
          placeholder="Search books..."
          leftSection={<IconSearch size={16} />}
        />
        <Box px="sm" py="xs">
          <Button.Group>
            {filterOptions.map(({ label, value }) => (
              <Button
                key={value}
                size="xs"
                variant={searchBy === value ? 'filled' : 'default'}
                onClick={() => setSearchBy(value)}
                style={{ flex: 1 }}
              >
                {label}
              </Button>
            ))}
          </Button.Group>
        </Box>
        <Spotlight.ActionsList>
          {spotlightQuery.length >= 2 ? (
            searchResults.length > 0 ? (
              searchResults.map((book) => (
                <Spotlight.Action
                  key={book.id}
                  onClick={() => handleSelectBook(book.id)}
                  p={0}
                >
                  <SearchResultItem book={book} />
                </Spotlight.Action>
              ))
            ) : (
              <Spotlight.Empty>No books found</Spotlight.Empty>
            )
          ) : (
            <Spotlight.Empty>
              Type at least 2 characters to search
            </Spotlight.Empty>
          )}
        </Spotlight.ActionsList>
      </Spotlight.Root>

      <BookDetailModal
        bookId={searchBookId}
        onClose={() => setSearchBookId(null)}
        onBookUpdated={() => {}}
      />
    </>
  );
}
