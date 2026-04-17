import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AppShell,
  Alert,
  Burger,
  Button,
  Group,
  Title,
  TextInput,
  Popover,
  UnstyledButton,
  Text,
  Box,
  ActionIcon,
  Tooltip,
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

function SearchResultItem({
  book,
  onClick,
}: {
  book: SearchBook;
  onClick: () => void;
}) {
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
    <UnstyledButton onClick={onClick} style={{ width: '100%' }}>
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
            <IconBook2 size={24} color="var(--mantine-color-dimmed)" />
          )}
        </Box>
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={500} lineClamp={1}>
            {book.title}
          </Text>
          {book.authors.length > 0 && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {book.authors.join(', ')}
            </Text>
          )}
          {seriesMeta && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {seriesMeta}
            </Text>
          )}
        </Box>
      </Group>
    </UnstyledButton>
  );
}

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchBook[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchBookId, setSearchBookId] = useState<string | null>(null);
  const [shelfmarkUrl, setShelfmarkUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setUserSettings = useSetAtom(userSettingsAtom);
  const backendStatus = useAtomValue(backendStatusAtom);
  const setSelectedBookIds = useSetAtom(selectedBookIdsAtom);
  const location = useLocation();

  useEffect(() => {
    setSelectedBookIds(new Set());
  }, [location.pathname, setSelectedBookIds]);
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light');

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
    if (searchQuery.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<SearchBook[]>(
          `/books?q=${encodeURIComponent(searchQuery)}&limit=8`,
        );
        setSearchResults(res.data);
        setSearchOpen(true);
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  return (
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

          <Popover
            opened={searchOpen}
            onClose={() => setSearchOpen(false)}
            width="target"
            position="bottom"
            withinPortal
            trapFocus={false}
          >
            <Popover.Target>
              <TextInput
                ref={inputRef}
                placeholder="Search..."
                leftSection={<IconSearch size={16} />}
                style={{ width: 400 }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                onFocus={() => {
                  if (searchResults.length > 0) setSearchOpen(true);
                }}
              />
            </Popover.Target>
            <Popover.Dropdown p={0}>
              {searchResults.length === 0 ? (
                <Text size="sm" c="dimmed" p="sm">
                  No results
                </Text>
              ) : (
                searchResults.map((book) => (
                  <SearchResultItem
                    key={book.id}
                    book={book}
                    onClick={() => {
                      setSearchBookId(book.id);
                      setSearchOpen(false);
                      setSearchQuery('');
                    }}
                  />
                ))
              )}
            </Popover.Dropdown>
          </Popover>

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

      <BookDetailModal
        bookId={searchBookId}
        onClose={() => setSearchBookId(null)}
        onBookUpdated={() => {}}
      />
    </AppShell>
  );
}
