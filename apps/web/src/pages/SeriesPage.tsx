import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Stack,
  Card,
  Text,
  Box,
  Center,
  SimpleGrid,
  Badge,
  Modal,
  SegmentedControl,
} from '@mantine/core';
import { IconBook2 } from '@tabler/icons-react';
import { useAtom } from 'jotai';
import { api } from '../utils/api';
import { PageHeader } from '../components/PageHeader';
import { userSettingsAtom } from '../store/atoms';
import type { UserSettings } from '../store/atoms';

interface SeriesListItem {
  id: string;
  name: string;
  ownedCount: number;
  totalBooks: number | null;
  coverBooks: Array<{ id: string; coverUpdatedAt: string }>;
  authors: string[];
}

function CoverStack({
  coverBooks,
}: {
  coverBooks: Array<{ id: string; coverUpdatedAt: string }>;
}) {
  const ids = coverBooks.slice(0, 3);
  const count = ids.length;

  if (count === 0) {
    return (
      <Box
        style={{
          width: 140,
          height: 130,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--mantine-color-gray-2)',
          borderRadius: 4,
        }}
      >
        <IconBook2 size={32} color="var(--mantine-color-dimmed)" />
      </Box>
    );
  }

  const transforms: {
    rotate: number;
    translateX: number;
    translateY: number;
  }[] = [
    { rotate: -18, translateX: -22, translateY: 6 },
    { rotate: -5, translateX: -8, translateY: 2 },
    { rotate: 8, translateX: 6, translateY: 0 },
  ];

  return (
    <Box style={{ position: 'relative', width: 140, height: 130 }}>
      {ids.map((book, i) => {
        const t = transforms[transforms.length - count + i] ?? transforms[i];
        return (
          <img
            key={book.id}
            src={`/api/v1/books/${book.id}/cover?v=${book.coverUpdatedAt}`}
            alt=""
            style={{
              position: 'absolute',
              left: 30,
              top: 8,
              width: 72,
              height: 104,
              objectFit: 'cover',
              borderRadius: 4,
              boxShadow: '0 3px 8px rgba(0,0,0,0.35)',
              transform: `rotate(${t.rotate}deg) translate(${t.translateX}px, ${t.translateY}px)`,
              transformOrigin: 'bottom center',
            }}
          />
        );
      })}
    </Box>
  );
}

function SeriesCard({
  series,
  onClick,
}: {
  series: SeriesListItem;
  onClick: () => void;
}) {
  const progress =
    series.totalBooks != null
      ? `${series.ownedCount} of ${series.totalBooks}`
      : `${series.ownedCount} book${series.ownedCount !== 1 ? 's' : ''}`;

  return (
    <Card
      shadow="sm"
      padding="md"
      radius="md"
      withBorder
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    >
      <Center mb="sm">
        <CoverStack coverBooks={series.coverBooks} />
      </Center>
      <Text fw={600} size="sm" lineClamp={2} ta="center">
        {series.name}
      </Text>
      {series.authors.length > 0 && (
        <Text size="xs" c="dimmed" lineClamp={1} ta="center" mt={2}>
          {series.authors.join(', ')}
        </Text>
      )}
      <Center mt="xs">
        <Badge variant="light" size="sm">
          {progress}
        </Badge>
      </Center>
    </Card>
  );
}

export function SeriesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userSettings, setUserSettings] = useAtom(userSettingsAtom);

  useEffect(() => {
    api
      .get<SeriesListItem[]>('/series')
      .then((res) => setSeriesList(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSizeChange(size: UserSettings['bookItemSize']) {
    setUserSettings((prev) => ({ ...prev, bookItemSize: size }));
    await api.patch('/users/me/settings', { bookItemSize: size });
  }

  return (
    <Stack>
      <PageHeader
        title="Series"
        onSettingsClick={() => setSettingsOpen(true)}
      />

      {!loading && seriesList.length === 0 && (
        <Center py="xl">
          <Text c="dimmed">
            No series found. Add books with series metadata to see them here.
          </Text>
        </Center>
      )}

      <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 6 }} spacing="md">
        {seriesList.map((series) => (
          <SeriesCard
            key={series.id}
            series={series}
            onClick={() =>
              navigate(`/series/${series.id}`, {
                state: { from: location.pathname },
              })
            }
          />
        ))}
      </SimpleGrid>

      <Modal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Series Settings"
        size="sm"
        centered
      >
        <Stack gap="sm">
          <div>
            <Text size="sm" fw={500} mb={4}>
              Book size
            </Text>
            <SegmentedControl
              value={userSettings.bookItemSize}
              onChange={(v) =>
                void handleSizeChange(v as UserSettings['bookItemSize'])
              }
              data={[
                { label: 'S', value: 'sm' },
                { label: 'M', value: 'md' },
                { label: 'L', value: 'lg' },
                { label: 'XL', value: 'xl' },
              ]}
              fullWidth
            />
          </div>
        </Stack>
      </Modal>
    </Stack>
  );
}
