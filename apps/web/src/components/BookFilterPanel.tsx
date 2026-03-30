import {
  Stack,
  Group,
  Text,
  Badge,
  Button,
  Divider,
  Chip,
  SegmentedControl,
  Checkbox,
  ScrollArea,
} from '@mantine/core';
import type {
  BookFilterState,
  ReadStatusValue,
  SeriesFilter,
} from '../types/bookFilter';
import { EMPTY_FILTER } from '../types/bookFilter';

interface BookFilterPanelProps {
  filters: BookFilterState;
  setFilters: (f: BookFilterState) => void;
  availableGenres: string[];
  availableTags: string[];
  availableFormats: string[];
  activeCount: number;
}

export function BookFilterPanel({
  filters,
  setFilters,
  availableGenres,
  availableTags,
  availableFormats,
  activeCount,
}: BookFilterPanelProps) {
  function set<K extends keyof BookFilterState>(
    key: K,
    value: BookFilterState[K],
  ) {
    setFilters({ ...filters, [key]: value });
  }

  return (
    <Stack
      gap="md"
      p="sm"
      style={{
        width: 280,
        background:
          'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))',
        borderRadius: 'var(--mantine-radius-md)',
        border:
          '1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))',
      }}
    >
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Text fw={600} size="sm">
            Filters
          </Text>
          {activeCount > 0 && (
            <Badge size="sm" circle>
              {activeCount}
            </Badge>
          )}
        </Group>
        {activeCount > 0 && (
          <Button
            variant="subtle"
            size="xs"
            onClick={() => setFilters(EMPTY_FILTER)}
          >
            Clear all
          </Button>
        )}
      </Group>

      <Divider />

      <Text size="xs" fw={500} c="dimmed" tt="uppercase" lts={0.5}>
        Read Status
      </Text>
      <Chip.Group
        multiple
        value={filters.readStatuses}
        onChange={(v) => set('readStatuses', v as ReadStatusValue[])}
      >
        <Group gap="xs" wrap="wrap">
          <Chip size="sm" value="UNREAD">
            Unread
          </Chip>
          <Chip size="sm" value="READING">
            Reading
          </Chip>
          <Chip size="sm" value="READ">
            Read
          </Chip>
          <Chip size="sm" value="WONT_READ">
            Won't Read
          </Chip>
        </Group>
      </Chip.Group>

      <Divider />

      <Text size="xs" fw={500} c="dimmed" tt="uppercase" lts={0.5}>
        Minimum Rating
      </Text>
      <SegmentedControl
        size="xs"
        fullWidth
        value={filters.minRating === null ? 'any' : String(filters.minRating)}
        onChange={(v) => set('minRating', v === 'any' ? null : Number(v))}
        data={[
          { label: 'Any', value: 'any' },
          { label: '★1+', value: '1' },
          { label: '★2+', value: '2' },
          { label: '★3+', value: '3' },
          { label: '★4+', value: '4' },
          { label: '★5', value: '5' },
        ]}
      />

      {availableFormats.length > 0 && (
        <>
          <Divider />
          <Text size="xs" fw={500} c="dimmed" tt="uppercase" lts={0.5}>
            Format
          </Text>
          <Chip.Group
            multiple
            value={filters.formats}
            onChange={(v) => set('formats', v)}
          >
            <Group gap="xs" wrap="wrap">
              {availableFormats.map((fmt) => (
                <Chip key={fmt} size="sm" value={fmt}>
                  {fmt}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </>
      )}

      <Divider />

      <Text size="xs" fw={500} c="dimmed" tt="uppercase" lts={0.5}>
        Series
      </Text>
      <SegmentedControl
        size="xs"
        fullWidth
        value={filters.seriesFilter}
        onChange={(v) => set('seriesFilter', v as SeriesFilter)}
        data={[
          { label: 'Any', value: 'any' },
          { label: 'In Series', value: 'has-series' },
          { label: 'Standalone', value: 'no-series' },
        ]}
      />

      {availableGenres.length > 0 && (
        <>
          <Divider />
          <Text size="xs" fw={500} c="dimmed" tt="uppercase" lts={0.5}>
            Genres
          </Text>
          <ScrollArea.Autosize mah={180}>
            <Stack gap={6}>
              {availableGenres.map((g) => (
                <Checkbox
                  key={g}
                  label={g}
                  size="sm"
                  checked={filters.genres.includes(g)}
                  onChange={(e) => {
                    const next = e.currentTarget.checked
                      ? [...filters.genres, g]
                      : filters.genres.filter((x) => x !== g);
                    set('genres', next);
                  }}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </>
      )}

      {availableTags.length > 0 && (
        <>
          <Divider />
          <Text size="xs" fw={500} c="dimmed" tt="uppercase" lts={0.5}>
            Tags
          </Text>
          <ScrollArea.Autosize mah={180}>
            <Stack gap={6}>
              {availableTags.map((t) => (
                <Checkbox
                  key={t}
                  label={t}
                  size="sm"
                  checked={filters.tags.includes(t)}
                  onChange={(e) => {
                    const next = e.currentTarget.checked
                      ? [...filters.tags, t]
                      : filters.tags.filter((x) => x !== t);
                    set('tags', next);
                  }}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </>
      )}
    </Stack>
  );
}
