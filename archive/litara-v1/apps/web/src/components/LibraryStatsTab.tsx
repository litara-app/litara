import { useState, useEffect } from 'react';
import {
  Stack,
  Paper,
  Text,
  Group,
  SimpleGrid,
  Skeleton,
  Center,
  ColorSwatch,
  useMantineTheme,
  getThemeColor,
} from '@mantine/core';
import { PieChart, BarChart, LineChart } from '@mantine/charts';
import { api } from '../utils/api';

interface PiePayloadItem {
  name: string;
  value: number;
  payload: { fill: string };
}

interface FormatTooltipProps {
  payload?: PiePayloadItem[];
  total: number;
}

interface PieSlice {
  name: string;
  value: number;
  color: string;
}

interface FormatLegendProps {
  pieData: PieSlice[];
  pieTotal: number;
}

function FormatLegend({ pieData, pieTotal }: FormatLegendProps) {
  const theme = useMantineTheme();
  return (
    <Stack gap={6}>
      {pieData.map((d) => (
        <Group key={d.name} gap="xs" wrap="nowrap">
          <ColorSwatch
            color={getThemeColor(d.color, theme)}
            size={12}
            withShadow={false}
          />
          <Text size="sm" fw={500}>
            {d.name}
          </Text>
          <Text size="sm" c="dimmed">
            {pieTotal > 0 ? `${((d.value / pieTotal) * 100).toFixed(1)}%` : '—'}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

function FormatTooltip({ payload, total }: FormatTooltipProps) {
  if (!payload || payload.length === 0) return null;
  const item = payload[0];
  const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0.0';
  return (
    <Paper withBorder p="xs" radius="sm" shadow="sm">
      <Group gap="xs" mb={4}>
        <ColorSwatch color={item.payload.fill} size={12} withShadow={false} />
        <Text size="sm" fw={600}>
          {item.name}
        </Text>
      </Group>
      <Text size="sm">
        {item.value.toLocaleString()} books ({pct}%)
      </Text>
    </Paper>
  );
}

interface LibraryStats {
  overview: {
    totalBooks: number;
    totalAuthors: number;
    totalSeries: number;
    totalPublishers: number;
    totalSizeBytes: string;
  };
  formatDistribution: Array<{ format: string; count: number }>;
  pageCountDistribution: Array<{ range: string; count: number }>;
  publicationByDecade: Array<{ decade: string; count: number }>;
  booksAddedOverTime: Array<{ month: string; count: number }>;
}

const FORMAT_COLORS: Record<string, string> = {
  EPUB: 'blue',
  PDF: 'red',
  MOBI: 'orange',
  AZW: 'yellow',
  AZW3: 'lime',
  CBZ: 'indigo',
  CBR: 'violet',
  CB7: 'cyan',
  FB2: 'teal',
};

const FALLBACK_COLORS = ['pink', 'grape', 'green', 'dark', 'gray'];

function formatBytes(bytesStr: string): string {
  const bytes = parseInt(bytesStr, 10);
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface StatCardProps {
  label: string;
  value: string | number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap={4} align="center">
        <Text size="xl" fw={700} lh={1}>
          {value}
        </Text>
        <Text size="xs" c="dimmed" tt="uppercase" fw={500} ta="center">
          {label}
        </Text>
      </Stack>
    </Paper>
  );
}

export function LibraryStatsTab() {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<LibraryStats>('/users/me/stats', { signal: controller.signal })
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 2, xs: 3, sm: 5 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={72} radius="md" />
          ))}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          <Skeleton h={200} radius="md" />
          <Skeleton h={200} radius="md" />
          <Skeleton h={200} radius="md" />
        </SimpleGrid>
        <Skeleton h={200} radius="md" />
      </Stack>
    );
  }

  if (!stats) {
    return (
      <Center h={200}>
        <Text c="dimmed">Failed to load statistics.</Text>
      </Center>
    );
  }

  const pieData = stats.formatDistribution.map((f, i) => ({
    name: f.format,
    value: f.count,
    color:
      FORMAT_COLORS[f.format] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }));
  const pieTotal = pieData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, xs: 3, sm: 5 }}>
        <StatCard
          label="Books"
          value={stats.overview.totalBooks.toLocaleString()}
        />
        <StatCard
          label="Authors"
          value={stats.overview.totalAuthors.toLocaleString()}
        />
        <StatCard
          label="Series"
          value={stats.overview.totalSeries.toLocaleString()}
        />
        <StatCard
          label="Publishers"
          value={stats.overview.totalPublishers.toLocaleString()}
        />
        <StatCard
          label="Library Size"
          value={formatBytes(stats.overview.totalSizeBytes)}
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm" size="sm">
            Format Distribution
          </Text>
          {pieData.length > 0 ? (
            <Group align="center" justify="space-between" wrap="nowrap">
              <PieChart
                data={pieData}
                size={160}
                withTooltip
                tooltipDataSource="segment"
                tooltipProps={{
                  content: ({ payload }) => (
                    <FormatTooltip
                      payload={payload as PiePayloadItem[]}
                      total={pieTotal}
                    />
                  ),
                }}
              />
              <FormatLegend pieData={pieData} pieTotal={pieTotal} />
            </Group>
          ) : (
            <Center h={160}>
              <Text c="dimmed" size="sm">
                No data
              </Text>
            </Center>
          )}
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm" size="sm">
            Page Count Distribution
          </Text>
          {stats.pageCountDistribution.length > 0 ? (
            <BarChart
              h={160}
              data={stats.pageCountDistribution}
              dataKey="range"
              series={[{ name: 'count', color: 'blue', label: 'Books' }]}
              tickLine="none"
              gridAxis="y"
              withTooltip
            />
          ) : (
            <Center h={160}>
              <Text c="dimmed" size="sm">
                No page count data
              </Text>
            </Center>
          )}
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm" size="sm">
            Publication Timeline by Decade
          </Text>
          {stats.publicationByDecade.length > 0 ? (
            <BarChart
              h={160}
              data={stats.publicationByDecade}
              dataKey="decade"
              series={[
                { name: 'count', color: 'teal', label: 'Books Published' },
              ]}
              tickLine="none"
              gridAxis="y"
              withTooltip
            />
          ) : (
            <Center h={160}>
              <Text c="dimmed" size="sm">
                No publication date data
              </Text>
            </Center>
          )}
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="md">
          Books Added Over Time
        </Text>
        {stats.booksAddedOverTime.length > 0 ? (
          <LineChart
            h={220}
            data={stats.booksAddedOverTime}
            dataKey="month"
            series={[{ name: 'count', color: 'violet', label: 'Books Added' }]}
            tickLine="none"
            gridAxis="y"
            withTooltip
            curveType="monotone"
          />
        ) : (
          <Center h={220}>
            <Text c="dimmed" size="sm">
              No data
            </Text>
          </Center>
        )}
      </Paper>
    </Stack>
  );
}
