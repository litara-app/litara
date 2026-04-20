import { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  Paper,
  Text,
  Group,
  SimpleGrid,
  Skeleton,
  Center,
  Tooltip,
  ColorSwatch,
  useMantineColorScheme,
  useMantineTheme,
  getThemeColor,
} from '@mantine/core';
import { BarChart, PieChart } from '@mantine/charts';
import { api } from '../utils/api';

interface ReadingStats {
  heatmapData: Array<{ date: string; count: number }>;
  peakHours: Array<{ hour: number; label: string; count: number }>;
  ratingDistribution: Array<{ label: string; count: number }>;
  readStatusDistribution: Array<{ status: string; count: number }>;
}

interface StatusPieItem {
  name: string;
  value: number;
  color: string;
}

interface StatusLegendProps {
  data: StatusPieItem[];
  total: number;
}

const STATUS_LABEL: Record<string, string> = {
  READING: 'Reading',
  READ: 'Read',
  UNREAD: 'Unread',
  WONT_READ: "Won't Read",
};

const STATUS_COLOR: Record<string, string> = {
  READING: 'blue',
  READ: 'teal',
  UNREAD: 'gray',
  WONT_READ: 'red',
};

function StatusLegend({ data, total }: StatusLegendProps) {
  const theme = useMantineTheme();
  return (
    <Stack gap={6}>
      {data.map((d) => (
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
            {total > 0 ? `${((d.value / total) * 100).toFixed(0)}%` : '—'}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

function CalendarHeatmap({
  data,
}: {
  data: Array<{ date: string; count: number }>;
}) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  const dateMap = useMemo(
    () => new Map(data.map((d) => [d.date, d.count])),
    [data],
  );
  const maxCount = useMemo(
    () => Math.max(...data.map((d) => d.count), 1),
    [data],
  );

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weeks = useMemo(() => {
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 52 * 7);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const result: Array<Array<Date | null>> = [];
    const curr = new Date(startDate);
    while (curr <= today) {
      const week: Array<Date | null> = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(curr);
        week.push(day <= today ? day : null);
        curr.setDate(curr.getDate() + 1);
      }
      result.push(week);
    }
    return result;
  }, [today]);

  const monthLabels = useMemo(() => {
    const labels = new Map<number, string>();
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
      const firstDay = week.find((d): d is Date => d !== null);
      if (!firstDay) return;
      const month = firstDay.getMonth();
      if (month !== lastMonth) {
        labels.set(
          wi,
          firstDay.toLocaleDateString('en-US', { month: 'short' }),
        );
        lastMonth = month;
      }
    });
    return labels;
  }, [weeks]);

  const getColor = (count: number): string => {
    if (count === 0) return isDark ? '#2d333b' : '#ebedf0';
    const intensity = count / maxCount;
    if (isDark) {
      if (intensity < 0.25) return '#0e4429';
      if (intensity < 0.5) return '#006d32';
      if (intensity < 0.75) return '#26a641';
      return '#39d353';
    }
    if (intensity < 0.25) return '#9be9a8';
    if (intensity < 0.5) return '#40c463';
    if (intensity < 0.75) return '#30a14e';
    return '#216e39';
  };

  const CELL = 13;
  const GAP = 2;

  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{ display: 'flex', gap: GAP, paddingLeft: 30, marginBottom: 4 }}
      >
        {weeks.map((_, wi) => (
          <div
            key={wi}
            style={{
              width: CELL,
              flexShrink: 0,
              fontSize: 10,
              color: 'var(--mantine-color-dimmed)',
              whiteSpace: 'nowrap',
            }}
          >
            {monthLabels.get(wi) ?? ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: GAP,
            width: 26,
            flexShrink: 0,
            alignItems: 'flex-end',
          }}
        >
          {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((label, di) => (
            <div
              key={di}
              style={{
                height: CELL,
                fontSize: 10,
                color: 'var(--mantine-color-dimmed)',
                lineHeight: `${CELL}px`,
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: GAP }}>
          {weeks.map((week, wi) => (
            <div
              key={wi}
              style={{ display: 'flex', flexDirection: 'column', gap: GAP }}
            >
              {week.map((date, di) => {
                if (!date)
                  return <div key={di} style={{ width: CELL, height: CELL }} />;
                const dateStr = date.toISOString().slice(0, 10);
                const count = dateMap.get(dateStr) ?? 0;
                return (
                  <Tooltip
                    key={di}
                    label={
                      count === 0
                        ? `${dateStr}: No activity`
                        : `${dateStr}: ${count} book${count === 1 ? '' : 's'}`
                    }
                    withArrow
                    fz="xs"
                    position="top"
                  >
                    <div
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 2,
                        backgroundColor: getColor(count),
                        cursor: 'default',
                      }}
                    />
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReadingClock({
  data,
}: {
  data: Array<{ hour: number; label: string; count: number }>;
}) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 48;
  const maxOuterR = cx - 18;
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const emptyFill = isDark ? '#2d333b' : '#e9ecef';
  const gridStroke = isDark ? '#373a40' : '#dee2e6';
  const innerFill = isDark ? '#25262b' : '#f1f3f5';
  const labelFill = isDark ? '#868e96' : '#868e96';

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const getBarColor = (intensity: number): string => {
    if (intensity < 0.33) return '#74c0fc';
    if (intensity < 0.66) return '#228be6';
    return '#1864ab';
  };

  const sectors = data.map((d) => {
    const startDeg = d.hour * 15 - 90;
    const endDeg = (d.hour + 1) * 15 - 91;
    const outerR =
      d.count === 0
        ? innerR + 4
        : innerR + (d.count / maxCount) * (maxOuterR - innerR);

    const ix1 = cx + innerR * Math.cos(toRad(startDeg));
    const iy1 = cy + innerR * Math.sin(toRad(startDeg));
    const ix2 = cx + innerR * Math.cos(toRad(endDeg));
    const iy2 = cy + innerR * Math.sin(toRad(endDeg));
    const ox1 = cx + outerR * Math.cos(toRad(startDeg));
    const oy1 = cy + outerR * Math.sin(toRad(startDeg));
    const ox2 = cx + outerR * Math.cos(toRad(endDeg));
    const oy2 = cy + outerR * Math.sin(toRad(endDeg));

    const pathD = `M ${ix1} ${iy1} L ${ox1} ${oy1} A ${outerR} ${outerR} 0 0 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 0 0 ${ix1} ${iy1} Z`;
    const fill = d.count === 0 ? emptyFill : getBarColor(d.count / maxCount);

    return { pathD, fill, label: d.label, count: d.count };
  });

  const hourMarkers: {
    label: string;
    angle: number;
    anchor: 'middle' | 'start' | 'end';
  }[] = [
    { label: '12am', angle: -90, anchor: 'middle' },
    { label: '6am', angle: 0, anchor: 'end' },
    { label: '12pm', angle: 90, anchor: 'middle' },
    { label: '6pm', angle: 180, anchor: 'start' },
  ];
  const labelR = maxOuterR + 14;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={cx}
        cy={cy}
        r={maxOuterR}
        fill="none"
        stroke={gridStroke}
        strokeWidth={1}
      />
      <circle
        cx={cx}
        cy={cy}
        r={(innerR + maxOuterR) / 2}
        fill="none"
        stroke={gridStroke}
        strokeWidth={0.5}
        strokeDasharray="2 4"
      />
      <circle cx={cx} cy={cy} r={innerR} fill={innerFill} />
      {sectors.map((s, i) => (
        <path key={i} d={s.pathD} fill={s.fill} />
      ))}
      {hourMarkers.map(({ label, angle, anchor }) => {
        const rad = toRad(angle);
        const x = cx + labelR * Math.cos(rad);
        const y = cy + labelR * Math.sin(rad);
        return (
          <text
            key={label}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={10}
            fill={labelFill}
          >
            {label}
          </text>
        );
      })}
      <circle cx={cx} cy={cy} r={3} fill="#228be6" />
    </svg>
  );
}

export function ReadingStatsTab() {
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<ReadingStats>('/users/me/reading-stats', {
        signal: controller.signal,
      })
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton h={130} radius="md" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Skeleton h={310} radius="md" />
          <Skeleton h={310} radius="md" />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Skeleton h={250} radius="md" />
          <Skeleton h={250} radius="md" />
        </SimpleGrid>
      </Stack>
    );
  }

  if (!stats) {
    return (
      <Center h={200}>
        <Text c="dimmed">Failed to load reading statistics.</Text>
      </Center>
    );
  }

  const statusPieData: StatusPieItem[] = stats.readStatusDistribution.map(
    (d) => ({
      name: STATUS_LABEL[d.status] ?? d.status,
      value: d.count,
      color: STATUS_COLOR[d.status] ?? 'gray',
    }),
  );
  const statusTotal = statusPieData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Stack gap="lg">
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="md">
          Reading Activity
        </Text>
        <CalendarHeatmap data={stats.heatmapData} />
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm" size="sm">
            Peak Reading Hours
          </Text>
          <BarChart
            h={260}
            data={stats.peakHours}
            dataKey="label"
            series={[{ name: 'count', color: 'blue', label: 'Sessions' }]}
            tickLine="none"
            gridAxis="y"
            withTooltip
            xAxisProps={{ interval: 2, tick: { fontSize: 11 } }}
          />
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm" size="sm">
            Reading Clock
          </Text>
          <Center>
            <ReadingClock data={stats.peakHours} />
          </Center>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm" size="sm">
            Rating Distribution
          </Text>
          {stats.ratingDistribution.some((d) => d.count > 0) ? (
            <BarChart
              h={220}
              data={stats.ratingDistribution}
              dataKey="label"
              series={[{ name: 'count', color: 'yellow', label: 'Books' }]}
              tickLine="none"
              gridAxis="y"
              withTooltip
              xAxisProps={{ tick: { fontSize: 11 } }}
            />
          ) : (
            <Center h={220}>
              <Text c="dimmed" size="sm">
                No ratings yet
              </Text>
            </Center>
          )}
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm" size="sm">
            Reading Status
          </Text>
          {statusPieData.length > 0 ? (
            <Group align="center" justify="space-between" wrap="nowrap" h={220}>
              <PieChart
                data={statusPieData}
                size={180}
                withTooltip
                tooltipDataSource="segment"
              />
              <StatusLegend data={statusPieData} total={statusTotal} />
            </Group>
          ) : (
            <Center h={220}>
              <Text c="dimmed" size="sm">
                No status data yet
              </Text>
            </Center>
          )}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
