import { useState, useMemo } from 'react';
import {
  Box,
  ScrollArea,
  Text,
  Group,
  Badge,
  Paper,
  MultiSelect,
  Button,
  TextInput,
  Stack,
  Center,
} from '@mantine/core';
import {
  IconBook2,
  IconSearch,
  IconArrowLeft,
  IconExternalLink,
} from '@tabler/icons-react';
import { pushToast } from '../utils/toast';
import { api } from '../utils/api';
import type {
  BookDetail,
  MetadataResult,
  MetadataSearchResult,
} from './BookDetailModal.types';
import { MetadataComparisonTable } from './MetadataComparisonTable';
import { isValidIsbn13, isValidIsbn10 } from './BookDetailModal.utils';
import { buildRows, buildApplyPayload } from './metadataApply.shared';

interface SearchMetadataTabProps {
  bookId: string;
  detail: BookDetail;
  lockedFields: Set<string>;
  onApplied: (updated: BookDetail) => void;
  onSwitchTab: (tab: string) => void;
}

function providerUrl(provider: string, result: MetadataResult): string | null {
  if (provider === 'google-books' && result.googleBooksId)
    return `https://books.google.com/books?id=${result.googleBooksId}`;
  if (provider === 'open-library' && result.openLibraryId)
    return `https://openlibrary.org${result.openLibraryId}`;
  if (provider === 'goodreads' && result.goodreadsId)
    return `https://www.goodreads.com/book/show/${result.goodreadsId}`;
  return null;
}

function providerColor(provider: string): string {
  switch (provider) {
    case 'hardcover':
      return 'orange';
    case 'open-library':
      return 'teal';
    case 'google-books':
      return 'blue';
    case 'goodreads':
      return 'green';
    default:
      return 'gray';
  }
}

function countResultFields(r: MetadataResult): number {
  const fields: Array<keyof MetadataResult> = [
    'title',
    'subtitle',
    'authors',
    'description',
    'publishedDate',
    'publisher',
    'language',
    'pageCount',
    'categories',
    'coverUrl',
    'isbn13',
    'isbn10',
  ];
  return fields.filter((k) => {
    const v = r[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.length > 0;
    return true;
  }).length;
}

export function SearchMetadataTab({
  bookId,
  detail,
  lockedFields,
  onApplied,
  onSwitchTab,
}: SearchMetadataTabProps) {
  const [searchProviders, setSearchProviders] = useState<string[]>([
    'hardcover',
    'open-library',
    'goodreads',
  ]);
  const [searchIsbn, setSearchIsbn] = useState(detail.isbn13 ?? '');
  const [searchTitle, setSearchTitle] = useState(detail.title);
  const [searchAuthor, setSearchAuthor] = useState(detail.authors[0] ?? '');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>(
    [],
  );
  const [searchHasRun, setSearchHasRun] = useState(false);
  const [selectedResult, setSelectedResult] =
    useState<MetadataSearchResult | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  async function handleSearch() {
    if (searchProviders.length === 0) return;
    setSearching(true);
    setSearchResults([]);
    setSearchHasRun(false);
    try {
      const params = new URLSearchParams();
      if (searchIsbn) params.set('isbn', searchIsbn);
      if (searchTitle) params.set('title', searchTitle);
      if (searchAuthor) params.set('author', searchAuthor);
      const providerLabel = (p: string) =>
        p === 'google-books'
          ? 'Google Books'
          : p === 'goodreads'
            ? 'Goodreads'
            : p === 'hardcover'
              ? 'Hardcover'
              : 'Open Library';

      const calls = searchProviders.map((p) =>
        api
          .get<MetadataResult[]>(
            `/books/${bookId}/search-metadata?provider=${p}&${params.toString()}`,
          )
          .then((res) => ({ provider: p, results: res.data ?? [] }))
          .catch(() => ({ provider: p, results: [] as MetadataResult[] })),
      );
      const raw = await Promise.all(calls);
      setSearchResults(
        raw.flatMap((r) =>
          r.results
            .filter((res) => countResultFields(res) > 0)
            .map((res) => ({
              provider: r.provider as
                | 'open-library'
                | 'google-books'
                | 'goodreads'
                | 'hardcover',
              providerLabel: providerLabel(r.provider),
              result: res,
            })),
        ),
      );
      setSearchHasRun(true);
    } finally {
      setSearching(false);
    }
  }

  function selectResult(r: MetadataSearchResult) {
    setSelectedResult(r);
    setSelectedFields(new Set());
  }

  function toggleField(field: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  const rows = useMemo(
    () =>
      selectedResult ? buildRows(detail, selectedResult.result, true) : [],
    [detail, selectedResult],
  );

  async function handleApply(onlySelected: boolean) {
    if (!selectedResult) return;
    const payload = buildApplyPayload(
      selectedResult.result,
      detail,
      lockedFields,
      true,
      onlySelected ? selectedFields : undefined,
    );
    if (Object.keys(payload).length === 0) {
      pushToast('Nothing to apply', { color: 'yellow' });
      return;
    }
    setApplying(true);
    try {
      await api.patch(`/books/${bookId}`, payload);
      const res = await api.get<BookDetail>(`/books/${bookId}`);
      onApplied(res.data);
      onSwitchTab('overview');
      pushToast('Metadata applied', { color: 'green' });
    } catch {
      pushToast('Failed to apply metadata', { title: 'Error', color: 'red' });
    } finally {
      setApplying(false);
    }
  }

  /* ── Detail view ── */
  if (selectedResult !== null) {
    const url = providerUrl(selectedResult.provider, selectedResult.result);

    return (
      <ScrollArea style={{ height: '100%' }}>
        <Box p="lg">
          <Group justify="space-between" mb="md">
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconArrowLeft size={14} />}
              onClick={() => setSelectedResult(null)}
            >
              Back to results
            </Button>
            {url && (
              <Button
                component="a"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                size="xs"
                variant="subtle"
                rightSection={<IconExternalLink size={12} />}
              >
                View on {selectedResult.providerLabel}
              </Button>
            )}
          </Group>

          <MetadataComparisonTable
            rows={rows}
            lockedFields={lockedFields}
            selectedFields={selectedFields}
            onToggleField={toggleField}
            sourceLabel={selectedResult.providerLabel}
          />

          <Group justify="space-between" mt="md" align="center">
            <Text size="xs" c="dimmed">
              Locked fields will not be overwritten.
            </Text>
            <Group gap="sm">
              {selectedFields.size > 0 && (
                <Button
                  variant="light"
                  loading={applying}
                  onClick={() => void handleApply(true)}
                >
                  Save Selected ({selectedFields.size})
                </Button>
              )}
              <Button
                loading={applying}
                onClick={() => void handleApply(false)}
              >
                Apply All
              </Button>
            </Group>
          </Group>
        </Box>
      </ScrollArea>
    );
  }

  /* ── Results list ── */
  return (
    <ScrollArea style={{ height: '100%' }}>
      <Box p="lg">
        <Group gap="sm" align="flex-end" mb="md" wrap="nowrap">
          <MultiSelect
            label="Providers"
            value={searchProviders}
            onChange={setSearchProviders}
            data={[
              { value: 'hardcover', label: 'Hardcover' },
              { value: 'open-library', label: 'Open Library' },
              { value: 'google-books', label: 'Google Books' },
              { value: 'goodreads', label: 'Goodreads' },
            ]}
            placeholder="Select..."
            style={{ flex: 1.5 }}
          />
          <TextInput
            label="ISBN"
            value={searchIsbn}
            onChange={(e) => setSearchIsbn(e.currentTarget.value)}
            placeholder="ISBN..."
            style={{ flex: 1 }}
          />
          <TextInput
            label="Title"
            value={searchTitle}
            onChange={(e) => setSearchTitle(e.currentTarget.value)}
            placeholder="Title..."
            style={{ flex: 2 }}
          />
          <TextInput
            label="Author"
            value={searchAuthor}
            onChange={(e) => setSearchAuthor(e.currentTarget.value)}
            placeholder="Author..."
            style={{ flex: 1.5 }}
          />
          <Button
            leftSection={<IconSearch size={14} />}
            loading={searching}
            disabled={searchProviders.length === 0}
            onClick={() => void handleSearch()}
            style={{ flexShrink: 0 }}
          >
            Search
          </Button>
        </Group>

        {searchHasRun && searchResults.length === 0 && (
          <Text c="dimmed" ta="center">
            No results found.
          </Text>
        )}

        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
          }}
        >
          {searchResults.map((r, i) => {
            const cardUrl = providerUrl(r.provider, r.result);
            const color = providerColor(r.provider);
            return (
              <Paper
                key={i}
                withBorder
                p="sm"
                radius="md"
                style={{
                  cursor: 'pointer',
                  position: 'relative',
                  borderColor: `var(--mantine-color-${color}-5)`,
                }}
                onClick={() => selectResult(r)}
              >
                {cardUrl && (
                  <Button
                    component="a"
                    href={cardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="xs"
                    variant="subtle"
                    rightSection={<IconExternalLink size={12} />}
                    style={{ position: 'absolute', top: 6, right: 6 }}
                    onClick={(e) => e.stopPropagation()}
                    px={6}
                  >
                    Open
                  </Button>
                )}

                <Group
                  gap="sm"
                  align="flex-start"
                  wrap="nowrap"
                  pr={cardUrl ? 80 : 0}
                >
                  {r.result.coverUrl ? (
                    <img
                      src={r.result.coverUrl}
                      alt={r.result.title}
                      style={{
                        width: 52,
                        height: 78,
                        objectFit: 'cover',
                        borderRadius: 4,
                        flexShrink: 0,
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <Center
                      style={{
                        width: 52,
                        height: 78,
                        background: 'var(--mantine-color-gray-1)',
                        borderRadius: 4,
                        flexShrink: 0,
                      }}
                    >
                      <IconBook2
                        size={20}
                        color="var(--mantine-color-gray-5)"
                      />
                    </Center>
                  )}
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600} size="sm" lineClamp={1}>
                      {r.result.title ?? '—'}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {r.result.authors?.join(', ') ?? '—'}
                    </Text>
                    {(r.result.publisher || r.result.publishedDate) && (
                      <Text size="xs" c="dimmed">
                        {[
                          r.result.publisher,
                          r.result.publishedDate
                            ? String(
                                new Date(
                                  r.result.publishedDate as unknown as string,
                                ).getFullYear(),
                              )
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    )}
                    {r.result.description && (
                      <Text size="xs" lineClamp={2} mt={2}>
                        {r.result.description}
                      </Text>
                    )}
                    {isValidIsbn13(r.result.isbn13) && (
                      <Text size="xs" c="dimmed">
                        ISBN-13: {r.result.isbn13}
                      </Text>
                    )}
                    {isValidIsbn10(r.result.isbn10) && (
                      <Text size="xs" c="dimmed">
                        ISBN-10: {r.result.isbn10}
                      </Text>
                    )}
                    <Group gap={4} mt={4} wrap="wrap" align="center">
                      <Badge size="xs" variant="light" color={color}>
                        {r.providerLabel}
                      </Badge>
                      <Badge size="xs" variant="outline">
                        {countResultFields(r.result)} fields
                      </Badge>
                    </Group>
                  </Stack>
                </Group>
              </Paper>
            );
          })}
        </Box>
      </Box>
    </ScrollArea>
  );
}
