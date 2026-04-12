import { useState, useEffect, useCallback } from 'react';
import {
  Title,
  Stack,
  Text,
  Paper,
  Group,
  Badge,
  Button,
  Alert,
  Modal,
  Loader,
  Center,
  Divider,
  Switch,
  Collapse,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCheck,
  IconX,
  IconEdit,
  IconSparkles,
  IconWriting,
  IconSearch,
} from '@tabler/icons-react';
import { useSetAtom } from 'jotai';
import { api } from '../utils/api';
import { pendingBookCountAtom } from '../store/atoms';
import type { AxiosError } from 'axios';
import { EditMetadataTab } from '../components/EditMetadataTab';
import { SearchMetadataTab } from '../components/SearchMetadataTab';
import type {
  EditedFields,
  BookDetail,
  MetadataResult,
} from '../components/BookDetailModal.types';

interface PendingBook {
  id: string;
  status: 'PENDING' | 'COLLISION';
  originalFilename: string;
  title: string | null;
  subtitle: string | null;
  authors: string; // JSON string[]
  seriesName: string | null;
  seriesPosition: number | null;
  seriesTotalBooks: number | null;
  publisher: string | null;
  publishedDate: string | null;
  language: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  pageCount: number | null;
  genres: string; // JSON string[]
  tags: string; // JSON string[]
  moods: string; // JSON string[]
  targetPath: string | null;
  collidingPath: string | null;
  createdAt: string;
}

function parseJsonArray(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function parseAuthors(raw: string): string {
  try {
    return (JSON.parse(raw) as string[]).join(', ');
  } catch {
    return raw;
  }
}

function pendingBookToEditedFields(book: PendingBook): EditedFields {
  const publishedYear = book.publishedDate
    ? String(new Date(book.publishedDate).getFullYear())
    : '';
  return {
    title: book.title ?? '',
    subtitle: book.subtitle ?? '',
    description: book.description ?? '',
    isbn13: book.isbn13 ?? '',
    isbn10: book.isbn10 ?? '',
    publisher: book.publisher ?? '',
    publishedYear,
    language: book.language ?? '',
    pageCount: book.pageCount ?? '',
    ageRating: '',
    authors: parseJsonArray(book.authors),
    tags: parseJsonArray(book.tags),
    genres: parseJsonArray(book.genres),
    moods: parseJsonArray(book.moods),
    seriesName: book.seriesName ?? '',
    seriesPosition: book.seriesPosition ?? '',
    seriesTotalBooks: book.seriesTotalBooks ?? '',
  };
}

function editedFieldsToPatch(fields: EditedFields) {
  const publishedDate =
    fields.publishedYear && fields.publishedYear.length === 4
      ? `${fields.publishedYear}-01-01`
      : undefined;
  return {
    title: fields.title || undefined,
    subtitle: fields.subtitle || undefined,
    authors: fields.authors.length ? fields.authors : undefined,
    seriesName: fields.seriesName || undefined,
    seriesPosition:
      fields.seriesPosition !== '' ? fields.seriesPosition : undefined,
    seriesTotalBooks:
      fields.seriesTotalBooks !== '' ? fields.seriesTotalBooks : undefined,
    publisher: fields.publisher || undefined,
    publishedDate,
    language: fields.language || undefined,
    description: fields.description || undefined,
    isbn10: fields.isbn10 || undefined,
    isbn13: fields.isbn13 || undefined,
    pageCount: fields.pageCount !== '' ? fields.pageCount : undefined,
    genres: fields.genres.length ? fields.genres : undefined,
    tags: fields.tags.length ? fields.tags : undefined,
    moods: fields.moods.length ? fields.moods : undefined,
  };
}

function pendingBookToDetail(book: PendingBook): BookDetail {
  return {
    id: book.id,
    title: book.title ?? '',
    subtitle: book.subtitle ?? null,
    description: book.description ?? null,
    isbn13: book.isbn13 ?? null,
    isbn10: book.isbn10 ?? null,
    goodreadsId: null,
    goodreadsRating: null,
    publisher: book.publisher ?? null,
    publishedDate: book.publishedDate ?? null,
    language: book.language ?? null,
    pageCount: book.pageCount ?? null,
    ageRating: null,
    lockedFields: [],
    hasCover: false,
    coverUpdatedAt: '',
    library: null,
    authors: parseJsonArray(book.authors),
    tags: parseJsonArray(book.tags),
    genres: parseJsonArray(book.genres),
    moods: parseJsonArray(book.moods),
    series: book.seriesName
      ? {
          id: '',
          name: book.seriesName,
          sequence: book.seriesPosition,
          totalBooks: book.seriesTotalBooks,
        }
      : null,
    files: [],
    userReview: { rating: null, readStatus: 'UNREAD' },
    shelves: [],
    sidecarFile: null,
    inReadingQueue: false,
  };
}

function PendingBookCard({
  book,
  onRefresh,
  diskWritesEnabled,
}: {
  book: PendingBook;
  onRefresh: () => void;
  diskWritesEnabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [editedFields, setEditedFields] = useState<EditedFields>(() =>
    pendingBookToEditedFields(book),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [overwriteModalOpen, setOverwriteModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lockedFields = new Set<string>();

  function updateField<K extends keyof EditedFields>(
    key: K,
    value: EditedFields[K],
  ) {
    setEditedFields((f) => ({ ...f, [key]: value }));
    setIsDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<PendingBook>(
        `/book-drop/${book.id}`,
        editedFieldsToPatch(editedFields),
      );
      setEditedFields(pendingBookToEditedFields(updated.data));
      setIsDirty(false);
      setEditing(false);
      onRefresh();
    } catch {
      setError('Failed to save metadata.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoEnrich() {
    setEnriching(true);
    setError(null);
    try {
      const res = await api.post<PendingBook>(`/book-drop/${book.id}/enrich`);
      setEditedFields(pendingBookToEditedFields(res.data));
      setIsDirty(false);
      setEditing(true);
      setSearching(false);
    } catch {
      setError('Metadata enrichment failed or no results found.');
    } finally {
      setEnriching(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setError(null);
    try {
      await api.post(`/book-drop/${book.id}/approve`);
      onRefresh();
    } catch (err) {
      const data = (
        err as AxiosError<{ message: string; collidingPath?: string }>
      ).response?.data;
      if ((err as AxiosError).response?.status === 409) {
        setError(
          data?.collidingPath
            ? `Collision: a file already exists at "${data.collidingPath}"`
            : (data?.message ?? 'Collision detected.'),
        );
        onRefresh();
      } else {
        setError(data?.message ?? 'Approval failed.');
      }
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    setError(null);
    try {
      await api.post(`/book-drop/${book.id}/reject`);
      onRefresh();
    } catch {
      setError('Rejection failed.');
    } finally {
      setRejecting(false);
    }
  }

  async function handleApproveOverwrite() {
    setOverwriteModalOpen(false);
    setApproving(true);
    setError(null);
    try {
      await api.post(`/book-drop/${book.id}/approve-overwrite`);
      onRefresh();
    } catch (err) {
      const data = (err as AxiosError<{ message: string }>).response?.data;
      setError(data?.message ?? 'Overwrite failed.');
    } finally {
      setApproving(false);
    }
  }

  const currentDetail = pendingBookToDetail(book);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2} style={{ flex: 1 }}>
            <Group gap="sm">
              <Text fw={600}>{book.title ?? book.originalFilename}</Text>
              <Badge
                color={book.status === 'COLLISION' ? 'orange' : 'blue'}
                size="sm"
              >
                {book.status}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {parseAuthors(book.authors) || 'Unknown author'}
              {book.seriesName &&
                ` · ${book.seriesName}${book.seriesPosition ? ` #${book.seriesPosition}` : ''}`}
            </Text>
            <Text size="xs" c="dimmed">
              {book.originalFilename}
            </Text>
            {book.targetPath && (
              <Text size="xs" c="dimmed">
                Target: <code>{book.targetPath}</code>
              </Text>
            )}
          </Stack>
          <Group gap="xs">
            <Button
              size="xs"
              variant={searching ? 'light' : 'subtle'}
              leftSection={<IconSearch size={14} />}
              onClick={() => {
                setSearching((v) => !v);
                setEditing(false);
              }}
            >
              Search Metadata
            </Button>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconSparkles size={14} />}
              onClick={() => void handleAutoEnrich()}
              loading={enriching}
              title="Auto-enrich from best provider match"
            >
              Auto-Enrich
            </Button>
            <Button
              size="xs"
              variant={editing ? 'light' : 'subtle'}
              leftSection={<IconEdit size={14} />}
              onClick={() => {
                setEditing((v) => !v);
                setSearching(false);
              }}
            >
              {editing ? 'Cancel' : 'Edit'}
            </Button>
          </Group>
        </Group>

        {book.status === 'COLLISION' && (
          <Alert icon={<IconAlertTriangle size={16} />} color="orange">
            <Text size="sm">
              A file already exists at this target path:{' '}
              <code>{book.collidingPath}</code>. You must approve the overwrite
              to proceed.
            </Text>
          </Alert>
        )}

        {error && (
          <Alert icon={<IconAlertTriangle size={16} />} color="red">
            {error}
          </Alert>
        )}

        <Collapse in={searching}>
          <Divider mb="sm" />
          <SearchMetadataTab
            detail={currentDetail}
            lockedFields={lockedFields}
            onSearch={(provider, params) =>
              api
                .get<MetadataResult[]>(
                  `/book-drop/${book.id}/search-metadata?provider=${provider}&${params.toString()}`,
                )
                .then((r) => r.data ?? [])
                .catch(() => [])
            }
            onApply={async (payload) => {
              await api.patch(`/book-drop/${book.id}`, payload);
              setSearching(false);
              onRefresh();
            }}
            scrollable={false}
          />
        </Collapse>

        <Collapse in={editing}>
          <Divider mb="sm" />
          <EditMetadataTab
            editedFields={editedFields}
            lockedFields={lockedFields}
            updateField={updateField}
            toggleLock={() => {}}
            setLockedFields={() => {}}
            setIsDirty={setIsDirty}
            scrollable={false}
          />
          {isDirty && (
            <Group mt="xs">
              <Button
                onClick={() => void handleSave()}
                loading={saving}
                size="sm"
              >
                Save Metadata
              </Button>
            </Group>
          )}
          <Divider mt="sm" />
        </Collapse>

        <Group gap="sm">
          {book.status === 'PENDING' && (
            <Button
              leftSection={<IconWriting size={16} />}
              color="green"
              size="sm"
              disabled={!diskWritesEnabled}
              onClick={() => void handleApprove()}
              loading={approving}
            >
              Write to Disk
            </Button>
          )}
          {book.status === 'COLLISION' && (
            <Button
              leftSection={<IconAlertTriangle size={16} />}
              color="orange"
              size="sm"
              onClick={() => setOverwriteModalOpen(true)}
              loading={approving}
            >
              Approve Overwrite
            </Button>
          )}
          <Button
            leftSection={<IconX size={16} />}
            color="red"
            variant="outline"
            size="sm"
            onClick={() => void handleReject()}
            loading={rejecting}
          >
            Reject
          </Button>
        </Group>
      </Stack>

      <Modal
        opened={overwriteModalOpen}
        onClose={() => setOverwriteModalOpen(false)}
        title="Confirm Overwrite"
      >
        <Stack gap="md">
          <Alert icon={<IconAlertTriangle size={16} />} color="orange">
            This will overwrite the existing file at:
            <br />
            <code>{book.collidingPath}</code>
          </Alert>
          <Text size="sm">
            This action cannot be undone. The existing file will be replaced.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setOverwriteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={() => void handleApproveOverwrite()}
            >
              Overwrite File
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}

export function AdminBookReviewPage() {
  const [books, setBooks] = useState<PendingBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkWriting, setBulkWriting] = useState(false);
  const [enrichBeforeWrite, setEnrichBeforeWrite] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    approved: number;
    collisions: number;
    failed: number;
  } | null>(null);
  const [diskWritesEnabled, setDiskWritesEnabled] = useState(true);
  const setPendingCount = useSetAtom(pendingBookCountAtom);

  useEffect(() => {
    api
      .get<{ allowDiskWrites: boolean; isReadOnlyMount: boolean }>(
        '/admin/settings/disk',
      )
      .then((r) =>
        setDiskWritesEnabled(r.data.allowDiskWrites && !r.data.isReadOnlyMount),
      )
      .catch(() => setDiskWritesEnabled(false));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<PendingBook[]>('/book-drop/pending')
      .then((r) => {
        setBooks(r.data);
        setPendingCount(r.data.length);
      })
      .finally(() => setLoading(false));
  }, [setPendingCount]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingCount = books.filter((b) => b.status === 'PENDING').length;

  async function handleWriteAll() {
    setBulkWriting(true);
    setBulkResult(null);
    try {
      if (enrichBeforeWrite) {
        await Promise.allSettled(
          books
            .filter((b) => b.status === 'PENDING')
            .map((b) => api.post(`/book-drop/${b.id}/enrich`)),
        );
      }
      const res = await api.post<{
        approved: number;
        collisions: number;
        failed: number;
      }>('/book-drop/approve-all');
      setBulkResult(res.data);
      load();
    } finally {
      setBulkWriting(false);
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Book Review</Title>
          <Text c="dimmed" mt={4}>
            Review books uploaded or dropped into the book drop folder. Approve
            to write them to the library.
          </Text>
        </div>
        {pendingCount > 0 && (
          <Group gap="sm" align="center">
            <Switch
              label="Enrich metadata"
              checked={enrichBeforeWrite}
              onChange={(e) => setEnrichBeforeWrite(e.currentTarget.checked)}
              disabled={bulkWriting}
            />
            <Button
              leftSection={
                enrichBeforeWrite ? (
                  <IconSparkles size={16} />
                ) : (
                  <IconWriting size={16} />
                )
              }
              color="teal"
              loading={bulkWriting}
              disabled={!diskWritesEnabled}
              onClick={() => void handleWriteAll()}
            >
              Write All to Disk ({pendingCount})
            </Button>
          </Group>
        )}
      </Group>

      {!diskWritesEnabled && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="orange"
          title="Disk writes disabled"
        >
          Writing to disk is currently disabled. Enable it in{' '}
          <a href="/admin-settings">Admin Settings</a> before approving books.
        </Alert>
      )}

      {bulkResult && (
        <Alert
          icon={<IconCheck size={16} />}
          color={bulkResult.failed > 0 ? 'yellow' : 'green'}
          title="Bulk write complete"
          withCloseButton
          onClose={() => setBulkResult(null)}
        >
          {bulkResult.approved} written to disk
          {bulkResult.collisions > 0 &&
            `, ${bulkResult.collisions} collision(s) require manual review`}
          {bulkResult.failed > 0 && `, ${bulkResult.failed} failed`}
        </Alert>
      )}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : books.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Text ta="center" c="dimmed">
            No books pending review.
          </Text>
        </Paper>
      ) : (
        <Stack gap="sm">
          {books.map((book) => (
            <PendingBookCard
              key={book.id}
              book={book}
              onRefresh={load}
              diskWritesEnabled={diskWritesEnabled}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
