import { useState } from 'react';
import {
  Stack,
  Group,
  Text,
  Badge,
  Button,
  Chip,
  SegmentedControl,
  Checkbox,
  ScrollArea,
  Accordion,
  TextInput,
  NumberInput,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type {
  BookFilterState,
  ReadStatusValue,
  SeriesFilter,
  FilterMode,
  AddedFilter,
  PageCountFilter,
  MediaTypeFilter,
} from '../types/bookFilter';
import { EMPTY_FILTER } from '../types/bookFilter';
import type { AuthorOption } from '../hooks/useBookFilter';

interface BookFilterPanelProps {
  filters: BookFilterState;
  setFilters: (f: BookFilterState) => void;
  availableGenres: string[];
  availableTags: string[];
  availableFormats: string[];
  availableMoods: string[];
  availablePublishers: string[];
  availableAuthors: AuthorOption[];
  activeCount: number;
}

export function BookFilterPanel({
  filters,
  setFilters,
  availableGenres,
  availableTags,
  availableFormats,
  availableMoods,
  availablePublishers,
  availableAuthors,
  activeCount,
}: BookFilterPanelProps) {
  const [authorSearch, setAuthorSearch] = useState('');

  function set<K extends keyof BookFilterState>(
    key: K,
    value: BookFilterState[K],
  ) {
    setFilters({ ...filters, [key]: value });
  }

  const filteredAuthors = authorSearch
    ? availableAuthors.filter((a) =>
        a.name.toLowerCase().includes(authorSearch.toLowerCase()),
      )
    : availableAuthors;

  return (
    <Stack
      gap="xs"
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
      {/* Header */}
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
            onClick={() =>
              setFilters({ ...EMPTY_FILTER, filterMode: filters.filterMode })
            }
          >
            Clear all
          </Button>
        )}
      </Group>

      {/* Global filter mode */}
      <SegmentedControl
        size="xs"
        fullWidth
        value={filters.filterMode}
        onChange={(v) => set('filterMode', v as FilterMode)}
        data={[
          { label: 'AND', value: 'and' },
          { label: 'OR', value: 'or' },
          { label: 'NOT', value: 'not' },
        ]}
      />

      <Accordion
        multiple
        defaultValue={['status']}
        variant="separated"
        styles={{
          item: { border: 'none', background: 'transparent' },
          control: { padding: '6px 4px' },
          content: { padding: '4px 4px 8px' },
          chevron: { marginLeft: 4 },
        }}
      >
        {/* Status */}
        <Accordion.Item value="status">
          <Accordion.Control>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" lts={0.5}>
              Status
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
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
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Rating */}
        <Accordion.Item value="rating">
          <Accordion.Control>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" lts={0.5}>
              Rating
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  My Rating (min)
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={
                    filters.minRating === null
                      ? 'any'
                      : String(filters.minRating)
                  }
                  onChange={(v) =>
                    set('minRating', v === 'any' ? null : Number(v))
                  }
                  data={[
                    { label: 'Any', value: 'any' },
                    { label: '★1+', value: '1' },
                    { label: '★2+', value: '2' },
                    { label: '★3+', value: '3' },
                    { label: '★4+', value: '4' },
                    { label: '★5', value: '5' },
                  ]}
                />
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Goodreads Rating (min)
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={
                    filters.minGoodreadsRating === null
                      ? 'any'
                      : String(filters.minGoodreadsRating)
                  }
                  onChange={(v) =>
                    set('minGoodreadsRating', v === 'any' ? null : Number(v))
                  }
                  data={[
                    { label: 'Any', value: 'any' },
                    { label: '3+', value: '3' },
                    { label: '3.5+', value: '3.5' },
                    { label: '4+', value: '4' },
                    { label: '4.5+', value: '4.5' },
                  ]}
                />
              </Stack>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Content */}
        {(availableGenres.length > 0 ||
          availableTags.length > 0 ||
          availableMoods.length > 0) && (
          <Accordion.Item value="content">
            <Accordion.Control>
              <Text size="xs" fw={600} tt="uppercase" c="dimmed" lts={0.5}>
                Content
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                {availableGenres.length > 0 && (
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">
                      Genres
                    </Text>
                    <ScrollArea.Autosize mah={160}>
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
                  </Stack>
                )}
                {availableTags.length > 0 && (
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">
                      Tags
                    </Text>
                    <ScrollArea.Autosize mah={160}>
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
                  </Stack>
                )}
                {availableMoods.length > 0 && (
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">
                      Moods
                    </Text>
                    <ScrollArea.Autosize mah={160}>
                      <Stack gap={6}>
                        {availableMoods.map((m) => (
                          <Checkbox
                            key={m}
                            label={m}
                            size="sm"
                            checked={filters.moods.includes(m)}
                            onChange={(e) => {
                              const next = e.currentTarget.checked
                                ? [...filters.moods, m]
                                : filters.moods.filter((x) => x !== m);
                              set('moods', next);
                            }}
                          />
                        ))}
                      </Stack>
                    </ScrollArea.Autosize>
                  </Stack>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {/* Authors */}
        {availableAuthors.length > 0 && (
          <Accordion.Item value="authors">
            <Accordion.Control>
              <Text size="xs" fw={600} tt="uppercase" c="dimmed" lts={0.5}>
                Authors
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <TextInput
                  size="xs"
                  placeholder="Search authors…"
                  leftSection={<IconSearch size={12} />}
                  value={authorSearch}
                  onChange={(e) => setAuthorSearch(e.currentTarget.value)}
                />
                <ScrollArea.Autosize mah={200}>
                  <Stack gap={6}>
                    {filteredAuthors.map(({ name, count }) => (
                      <Checkbox
                        key={name}
                        label={
                          <Text size="sm">
                            {name}{' '}
                            <Text span size="xs" c="dimmed">
                              ({count})
                            </Text>
                          </Text>
                        }
                        size="sm"
                        checked={filters.authors.includes(name)}
                        onChange={(e) => {
                          const next = e.currentTarget.checked
                            ? [...filters.authors, name]
                            : filters.authors.filter((x) => x !== name);
                          set('authors', next);
                        }}
                      />
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {/* Book Details */}
        <Accordion.Item value="details">
          <Accordion.Control>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" lts={0.5}>
              Book Details
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              {availableFormats.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed">
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
                </Stack>
              )}
              {availablePublishers.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed">
                    Publisher
                  </Text>
                  <ScrollArea.Autosize mah={160}>
                    <Stack gap={6}>
                      {availablePublishers.map((p) => (
                        <Checkbox
                          key={p}
                          label={p}
                          size="sm"
                          checked={filters.publishers.includes(p)}
                          onChange={(e) => {
                            const next = e.currentTarget.checked
                              ? [...filters.publishers, p]
                              : filters.publishers.filter((x) => x !== p);
                            set('publishers', next);
                          }}
                        />
                      ))}
                    </Stack>
                  </ScrollArea.Autosize>
                </Stack>
              )}
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Page Count
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={filters.pageCountFilter}
                  onChange={(v) => set('pageCountFilter', v as PageCountFilter)}
                  data={[
                    { label: 'Any', value: 'any' },
                    { label: '<150', value: 'short' },
                    { label: '150–400', value: 'medium' },
                    { label: '400+', value: 'long' },
                  ]}
                />
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Published Year
                </Text>
                <Group gap="xs" align="center">
                  <NumberInput
                    size="xs"
                    placeholder="From"
                    min={1000}
                    max={9999}
                    hideControls
                    value={filters.publishedYearFrom ?? ''}
                    onChange={(v) =>
                      set('publishedYearFrom', v === '' ? null : Number(v))
                    }
                    style={{ flex: 1 }}
                  />
                  <Text size="xs" c="dimmed">
                    –
                  </Text>
                  <NumberInput
                    size="xs"
                    placeholder="To"
                    min={1000}
                    max={9999}
                    hideControls
                    value={filters.publishedYearTo ?? ''}
                    onChange={(v) =>
                      set('publishedYearTo', v === '' ? null : Number(v))
                    }
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Library */}
        <Accordion.Item value="library">
          <Accordion.Control>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" lts={0.5}>
              Library
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Media Type
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={filters.mediaTypeFilter}
                  onChange={(v) => set('mediaTypeFilter', v as MediaTypeFilter)}
                  data={[
                    { label: 'Any', value: 'any' },
                    { label: 'Ebook', value: 'ebook-only' },
                    { label: 'Audio', value: 'audiobook-only' },
                    { label: 'Both', value: 'both' },
                  ]}
                />
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
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
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Added to Library
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={filters.addedFilter}
                  onChange={(v) => set('addedFilter', v as AddedFilter)}
                  data={[
                    { label: 'Any', value: 'any' },
                    { label: '7d', value: 'last-7' },
                    { label: '30d', value: 'last-30' },
                    { label: '6mo', value: 'last-180' },
                  ]}
                />
              </Stack>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
