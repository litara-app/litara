import { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import {
  Box,
  ScrollArea,
  Title,
  Text,
  Group,
  Badge,
  Paper,
  Select,
  MultiSelect,
  Rating,
  SimpleGrid,
  Stack,
  ActionIcon,
  TextInput,
} from '@mantine/core';
import { IconCheck, IconPlus, IconX } from '@tabler/icons-react';
import { useSetAtom } from 'jotai';
import { librariesAtom, shelvesAtom } from '../store/atoms';
import { api } from '../utils/api';
import type { BookDetail, Library, Shelf } from './BookDetailModal.types';
import { FileRow, DetailRow } from './BookDetailModal.shared';

interface OverviewTabProps {
  detail: BookDetail;
  onDownload: (fileId: string) => void;
}

export function OverviewTab({ detail, onDownload }: OverviewTabProps) {
  const [rating, setRating] = useState(detail.userReview.rating ?? 0);
  const [readStatus, setReadStatus] = useState(detail.userReview.readStatus);
  const [libraryId, setLibraryId] = useState(detail.library?.id ?? '');
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [addingLibrary, setAddingLibrary] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [selectedShelfIds, setSelectedShelfIds] = useState<string[]>(
    detail.shelves.map((s) => s.id),
  );
  const [allShelves, setAllShelves] = useState<Shelf[]>([]);
  const [addingShelf, setAddingShelf] = useState(false);
  const [newShelfName, setNewShelfName] = useState('');
  const [savingShelf, setSavingShelf] = useState(false);

  const setLibrariesAtom = useSetAtom(librariesAtom);
  const setShelvesAtom = useSetAtom(shelvesAtom);
  const skipSaveRef = useRef(true);

  useEffect(() => {
    Promise.all([
      api.get<Library[]>('/libraries'),
      api.get<Shelf[]>('/shelves'),
    ]).then(([libsRes, shelvesRes]) => {
      setLibraries(libsRes.data);
      setAllShelves(shelvesRes.data);
    });
  }, []);

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      void api.patch(`/books/${detail.id}`, { rating, readStatus });
    }, 600);
    return () => clearTimeout(t);
  }, [rating, readStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLibraryChange(value: string | null) {
    if (!value) return;
    if (value === '__add__') {
      setAddingLibrary(true);
      return;
    }
    setLibraryId(value);
    await api.patch(`/books/${detail.id}`, { libraryId: value });
  }

  async function handleCreateLibrary() {
    if (!newLibraryName.trim()) return;
    setSavingLibrary(true);
    try {
      const res = await api.post<Library>('/libraries', {
        name: newLibraryName.trim(),
      });
      setLibraries((prev) => [...prev, res.data]);
      setLibrariesAtom((prev) => [...prev, res.data]);
      setLibraryId(res.data.id);
      setAddingLibrary(false);
      setNewLibraryName('');
      await api.patch(`/books/${detail.id}`, { libraryId: res.data.id });
    } finally {
      setSavingLibrary(false);
    }
  }

  async function handleShelvesChange(ids: string[]) {
    setSelectedShelfIds(ids);
    await api.put(`/books/${detail.id}/shelves`, { shelfIds: ids });
  }

  async function handleCreateShelf() {
    if (!newShelfName.trim()) return;
    setSavingShelf(true);
    try {
      const res = await api.post<Shelf>('/shelves', {
        name: newShelfName.trim(),
      });
      setAllShelves((prev) => [...prev, res.data]);
      setShelvesAtom((prev) => [...prev, res.data]);
      const newIds = [...selectedShelfIds, res.data.id];
      setSelectedShelfIds(newIds);
      setAddingShelf(false);
      setNewShelfName('');
      await api.put(`/books/${detail.id}/shelves`, { shelfIds: newIds });
    } finally {
      setSavingShelf(false);
    }
  }

  function renderDescription(desc: string) {
    if (/<[a-z]/i.test(desc)) {
      return (
        <div
          style={{ fontSize: 14 }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(desc) }}
        />
      );
    }
    return (
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
        {desc}
      </Text>
    );
  }

  const librarySelectData = [
    ...libraries.map((l) => ({ value: l.id, label: l.name })),
    { value: '__add__', label: '＋ Add new library' },
  ];

  return (
    <ScrollArea style={{ height: '100%' }}>
      <Box p="lg">
        <Title order={2} mb={4}>
          {detail.title}
        </Title>
        {detail.subtitle && (
          <Text size="sm" c="dimmed" mb={8}>
            {detail.subtitle}
          </Text>
        )}
        <Group gap={6} mb="md" wrap="wrap">
          {detail.authors.length > 0 ? (
            detail.authors.map((a) => (
              <Badge key={a} size="sm" variant="light">
                {a}
              </Badge>
            ))
          ) : (
            <Text size="sm" c="dimmed">
              Unknown author
            </Text>
          )}
        </Group>

        {/* User data */}
        <Paper withBorder p="md" radius="md" mb="md">
          <SimpleGrid cols={2} spacing="md">
            <Stack gap="xs">
              <Box>
                <Text size="xs" c="dimmed" mb={4}>
                  Rating
                </Text>
                <Rating value={rating} onChange={setRating} fractions={2} />
              </Box>
              <Select
                label="Read Status"
                value={readStatus}
                onChange={(v) => v && setReadStatus(v)}
                data={[
                  { value: 'UNREAD', label: 'Unread' },
                  { value: 'READING', label: 'Reading' },
                  { value: 'READ', label: 'Read' },
                  { value: 'WONT_READ', label: "Won't Read" },
                ]}
                size="xs"
              />
            </Stack>
            <Stack gap="xs">
              <Box>
                <Text size="xs" c="dimmed" mb={4}>
                  Library
                </Text>
                {addingLibrary ? (
                  <Group gap="xs">
                    <TextInput
                      size="xs"
                      placeholder="Library name"
                      value={newLibraryName}
                      onChange={(e) => setNewLibraryName(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateLibrary();
                        if (e.key === 'Escape') setAddingLibrary(false);
                      }}
                      style={{ flex: 1 }}
                      autoFocus
                    />
                    <ActionIcon
                      size="sm"
                      variant="filled"
                      loading={savingLibrary}
                      onClick={() => void handleCreateLibrary()}
                    >
                      <IconCheck size={12} />
                    </ActionIcon>
                  </Group>
                ) : (
                  <Select
                    value={libraryId}
                    onChange={(v) => void handleLibraryChange(v)}
                    data={librarySelectData}
                    size="xs"
                  />
                )}
              </Box>
              <Box>
                <Text size="xs" c="dimmed" mb={4}>
                  Shelves
                </Text>
                {addingShelf ? (
                  <Group gap="xs">
                    <TextInput
                      size="xs"
                      placeholder="Shelf name"
                      value={newShelfName}
                      onChange={(e) => setNewShelfName(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateShelf();
                        if (e.key === 'Escape') setAddingShelf(false);
                      }}
                      style={{ flex: 1 }}
                      autoFocus
                    />
                    <ActionIcon
                      size="sm"
                      variant="filled"
                      loading={savingShelf}
                      onClick={() => void handleCreateShelf()}
                    >
                      <IconCheck size={12} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => setAddingShelf(false)}
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  </Group>
                ) : (
                  <Group gap="xs" align="center">
                    <MultiSelect
                      value={selectedShelfIds}
                      onChange={(ids) => void handleShelvesChange(ids)}
                      data={allShelves.map((s) => ({
                        value: s.id,
                        label: s.name,
                      }))}
                      placeholder="Add to shelf..."
                      size="xs"
                      style={{ flex: 1 }}
                      clearable
                    />
                    <ActionIcon
                      size="sm"
                      variant="light"
                      onClick={() => setAddingShelf(true)}
                      title="New shelf"
                    >
                      <IconPlus size={12} />
                    </ActionIcon>
                  </Group>
                )}
              </Box>
            </Stack>
          </SimpleGrid>
        </Paper>

        {/* Synopsis */}
        {detail.description && (
          <Box mb="md">
            <Text fw={600} mb="xs">
              Synopsis
            </Text>
            {renderDescription(detail.description)}
          </Box>
        )}

        {/* Details */}
        <Paper withBorder p="md" radius="md" mb="md">
          <Text fw={600} mb="sm">
            Details
          </Text>
          <SimpleGrid cols={2} spacing="sm">
            <DetailRow
              label="Authors"
              value={detail.authors.join(', ') || '—'}
            />
            <DetailRow label="Publisher" value={detail.publisher} />
            <DetailRow
              label="Published"
              value={
                detail.publishedDate
                  ? String(new Date(detail.publishedDate).getFullYear())
                  : null
              }
            />
            <DetailRow label="Language" value={detail.language} />
            <DetailRow label="Pages" value={detail.pageCount} />
            <DetailRow label="ISBN-13" value={detail.isbn13} />
            <DetailRow label="ISBN-10" value={detail.isbn10} />
            <DetailRow label="Age Rating" value={detail.ageRating} />
            <DetailRow
              label="Series"
              value={
                detail.series
                  ? `${detail.series.name}${detail.series.sequence != null ? ` #${detail.series.sequence}` : ''}${detail.series.totalBooks != null ? ` (of ${detail.series.totalBooks})` : ''}`
                  : null
              }
            />
            <DetailRow label="Goodreads ID" value={detail.goodreadsId} />
            <DetailRow
              label="Goodreads Rating"
              value={
                detail.goodreadsRating != null
                  ? String(detail.goodreadsRating)
                  : null
              }
            />
          </SimpleGrid>
          {detail.tags.length > 0 && (
            <Box mt="sm">
              <Text size="xs" c="dimmed" mb={4}>
                Tags
              </Text>
              <Group gap={4} wrap="wrap">
                {detail.tags.map((t) => (
                  <Badge key={t} size="xs" variant="outline">
                    {t}
                  </Badge>
                ))}
              </Group>
            </Box>
          )}
          {detail.genres.length > 0 && (
            <Box mt="sm">
              <Text size="xs" c="dimmed" mb={4}>
                Genres
              </Text>
              <Group gap={4} wrap="wrap">
                {detail.genres.map((g) => (
                  <Badge key={g} size="xs" variant="outline" color="violet">
                    {g}
                  </Badge>
                ))}
              </Group>
            </Box>
          )}
          {detail.moods.length > 0 && (
            <Box mt="sm">
              <Text size="xs" c="dimmed" mb={4}>
                Moods
              </Text>
              <Group gap={4} wrap="wrap">
                {detail.moods.map((m) => (
                  <Badge key={m} size="xs" variant="outline" color="teal">
                    {m}
                  </Badge>
                ))}
              </Group>
            </Box>
          )}
        </Paper>

        {/* Files */}
        {detail.files.length > 0 && (
          <Paper withBorder p="md" radius="md">
            <Text fw={600} mb="sm">
              Files
            </Text>
            <Stack gap={8}>
              {detail.files.map((f) => (
                <FileRow key={f.id} file={f} onDownload={onDownload} />
              ))}
            </Stack>
          </Paper>
        )}
      </Box>
    </ScrollArea>
  );
}
