import { useState, useEffect } from 'react';
import {
  Title,
  Stack,
  Card,
  Text,
  Box,
  Center,
  SimpleGrid,
  Badge,
} from '@mantine/core';
import { IconBook2 } from '@tabler/icons-react';
import { api } from '../utils/api';
import { SeriesDetailModal } from '../components/SeriesDetailModal';

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

  // Offsets and rotations for splayed stack effect (back to front).
  // Larger rotate + translateX values so back covers are clearly visible.
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
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SeriesListItem[]>('/series')
      .then((res) => setSeriesList(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Stack>
      <Title order={2}>Series</Title>

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
            onClick={() => setActiveSeriesId(series.id)}
          />
        ))}
      </SimpleGrid>

      <SeriesDetailModal
        seriesId={activeSeriesId}
        onClose={() => setActiveSeriesId(null)}
      />
    </Stack>
  );
}
