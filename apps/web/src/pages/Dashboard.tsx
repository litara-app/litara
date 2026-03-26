import { useState, useEffect, useCallback } from 'react';
import { useAtom } from 'jotai';
import {
  Stack,
  Paper,
  Title,
  Card,
  Text,
  Group,
  ActionIcon,
  Modal,
  Switch,
  Button,
  AspectRatio,
  Center,
  Skeleton,
  Badge,
  Box,
  Tooltip,
} from '@mantine/core';
import {
  IconClock,
  IconSettings,
  IconBook2,
  IconChevronUp,
  IconChevronDown,
  IconFileX,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import { BookDetailModal } from '../components/BookDetailModal';
import { userSettingsAtom } from '../store/atoms';
import type { DashboardSection } from '../store/atoms';

interface Book {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt: string;
  createdAt: string;
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

const ITEM_MIN_WIDTHS: Record<string, number> = {
  sm: 120,
  md: 160,
  lg: 210,
  xl: 260,
};

function BookCard({
  id,
  title,
  authors,
  hasCover,
  coverUpdatedAt,
  formats,
  hasFileMissing,
  onClick,
}: {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
  hasFileMissing: boolean;
  onClick?: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showCover = hasCover && !imgError;

  return (
    <Card
      shadow="sm"
      padding="sm"
      radius="md"
      withBorder
      className="book-card"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      <Box mb="sm" style={{ position: 'relative' }}>
        <AspectRatio ratio={2 / 3}>
          {showCover ? (
            <img
              src={`/api/v1/books/${id}/cover?v=${coverUpdatedAt}`}
              alt={title}
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
          {formats.map((fmt) => (
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
        {hasFileMissing && (
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
        {title}
      </Text>
      <Text size="xs" c="dimmed" mt={4}>
        {authors.join(', ') || 'Unknown'}
      </Text>
    </Card>
  );
}

function RecentlyAddedSection({
  books,
  loading,
  minWidth,
  onBookClick,
}: {
  books: Book[];
  loading: boolean;
  minWidth: number;
  onBookClick?: (id: string) => void;
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group mb="md" gap="xs">
        <IconClock size={20} />
        <Title order={4}>Recently Added</Title>
      </Group>
      {loading ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
            gap: '16px',
          }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={200} radius="md" />
          ))}
        </div>
      ) : books.length === 0 ? (
        <Text c="dimmed" size="sm">
          No books yet. Add some ebooks to your library folder.
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
              id={book.id}
              title={book.title}
              authors={book.authors}
              hasCover={book.hasCover}
              coverUpdatedAt={book.coverUpdatedAt}
              formats={book.formats}
              hasFileMissing={book.hasFileMissing}
              onClick={onBookClick ? () => onBookClick(book.id) : undefined}
            />
          ))}
        </div>
      )}
    </Paper>
  );
}

function SettingsModal({
  opened,
  onClose,
  layout,
  onSave,
}: {
  opened: boolean;
  onClose: () => void;
  layout: DashboardSection[];
  onSave: (layout: DashboardSection[]) => void;
}) {
  const [localLayout, setLocalLayout] = useState<DashboardSection[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (opened) setLocalLayout([...layout].sort((a, b) => a.order - b.order));
  }, [opened, layout]);

  function toggleVisible(key: string) {
    setLocalLayout((prev) =>
      prev.map((s) => (s.key === key ? { ...s, visible: !s.visible } : s)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...localLayout];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setLocalLayout(next.map((s, i) => ({ ...s, order: i })));
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Dashboard Settings"
      size="sm"
    >
      <Stack gap="sm">
        {localLayout.map((section, i) => (
          <Group key={section.key} justify="space-between">
            <Text size="sm">{section.label}</Text>
            <Group gap="xs">
              <Switch
                checked={section.visible}
                onChange={() => toggleVisible(section.key)}
                size="sm"
              />
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => move(i, -1)}
                disabled={i === 0}
              >
                <IconChevronUp size={14} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => move(i, 1)}
                disabled={i === localLayout.length - 1}
              >
                <IconChevronDown size={14} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
        <Button mt="sm" onClick={() => onSave(localLayout)}>
          Save
        </Button>
      </Stack>
    </Modal>
  );
}

export function Dashboard() {
  const [recentlyAdded, setRecentlyAdded] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useAtom(userSettingsAtom);

  const load = useCallback(async () => {
    const booksRes = await api
      .get<Book[]>('/books?limit=10&sortBy=createdAt&order=desc')
      .catch(() => null);
    if (booksRes) setRecentlyAdded(booksRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function saveLayout(newLayout: DashboardSection[]) {
    setUserSettings((prev) => ({ ...prev, dashboardLayout: newLayout }));
    setSettingsOpen(false);
    await api.patch('/users/me/settings', { dashboardLayout: newLayout });
  }

  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;
  const sorted = [...userSettings.dashboardLayout]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.visible);

  return (
    <Stack>
      <Group justify="space-between" align="center">
        <Title order={2}>Dashboard</Title>
        <ActionIcon variant="subtle" onClick={() => setSettingsOpen(true)}>
          <IconSettings size={20} />
        </ActionIcon>
      </Group>

      {sorted.map((section) => {
        if (section.key === 'recently-added') {
          return (
            <RecentlyAddedSection
              key={section.key}
              books={recentlyAdded}
              loading={loading}
              minWidth={minWidth}
              onBookClick={setSelectedBookId}
            />
          );
        }
        return null;
      })}

      <BookDetailModal
        bookId={selectedBookId}
        onClose={() => setSelectedBookId(null)}
        onBookUpdated={() => void load()}
      />

      <SettingsModal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        layout={userSettings.dashboardLayout}
        onSave={saveLayout}
      />
    </Stack>
  );
}
