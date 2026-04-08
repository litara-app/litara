import { useState, useEffect, useCallback } from 'react';
import {
  Title,
  Stack,
  Text,
  Paper,
  Group,
  Badge,
  Button,
  TextInput,
  Textarea,
  NumberInput,
  Alert,
  Modal,
  Loader,
  Center,
  Divider,
  Switch,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCheck,
  IconX,
  IconEdit,
  IconSparkles,
  IconWriting,
} from '@tabler/icons-react';
import { useSetAtom } from 'jotai';
import { api } from '../utils/api';
import { pendingBookCountAtom } from '../store/atoms';
import type { AxiosError } from 'axios';

interface PendingBook {
  id: string;
  status: 'PENDING' | 'COLLISION';
  originalFilename: string;
  title: string | null;
  authors: string; // JSON string[]
  seriesName: string | null;
  seriesPosition: number | null;
  publisher: string | null;
  language: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  targetPath: string | null;
  collidingPath: string | null;
  createdAt: string;
}

function parseAuthors(raw: string): string {
  try {
    return (JSON.parse(raw) as string[]).join(', ');
  } catch {
    return raw;
  }
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
  const [form, setForm] = useState({
    title: book.title ?? '',
    authors: parseAuthors(book.authors),
    seriesName: book.seriesName ?? '',
    seriesPosition: book.seriesPosition ?? ('' as number | ''),
    publisher: book.publisher ?? '',
    language: book.language ?? '',
    description: book.description ?? '',
    isbn10: book.isbn10 ?? '',
    isbn13: book.isbn13 ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [overwriteModalOpen, setOverwriteModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/book-drop/${book.id}`, {
        title: form.title || undefined,
        authors: form.authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        seriesName: form.seriesName || undefined,
        seriesPosition:
          form.seriesPosition !== '' ? form.seriesPosition : undefined,
        publisher: form.publisher || undefined,
        language: form.language || undefined,
        description: form.description || undefined,
        isbn10: form.isbn10 || undefined,
        isbn13: form.isbn13 || undefined,
      });
      setEditing(false);
      onRefresh();
    } catch {
      setError('Failed to save metadata.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEnrich() {
    setEnriching(true);
    setError(null);
    try {
      const res = await api.post<PendingBook>(`/book-drop/${book.id}/enrich`);
      const enriched = res.data;
      setForm({
        title: enriched.title ?? '',
        authors: parseAuthors(enriched.authors),
        seriesName: enriched.seriesName ?? '',
        seriesPosition: enriched.seriesPosition ?? '',
        publisher: enriched.publisher ?? '',
        language: enriched.language ?? '',
        description: enriched.description ?? '',
        isbn10: enriched.isbn10 ?? '',
        isbn13: enriched.isbn13 ?? '',
      });
      setEditing(true);
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
              variant="subtle"
              leftSection={<IconSparkles size={14} />}
              onClick={() => void handleEnrich()}
              loading={enriching}
            >
              Enrich
            </Button>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconEdit size={14} />}
              onClick={() => setEditing((v) => !v)}
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

        {editing && (
          <Stack gap="sm">
            <Divider />
            <Group grow>
              <TextInput
                label="Title"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.currentTarget.value }))
                }
              />
              <TextInput
                label="Authors (comma-separated)"
                value={form.authors}
                onChange={(e) =>
                  setForm((f) => ({ ...f, authors: e.currentTarget.value }))
                }
              />
            </Group>
            <Group grow>
              <TextInput
                label="Series Name"
                value={form.seriesName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, seriesName: e.currentTarget.value }))
                }
              />
              <NumberInput
                label="Series Position"
                value={form.seriesPosition}
                onChange={(v) =>
                  setForm((f) => ({ ...f, seriesPosition: v as number | '' }))
                }
                allowDecimal
              />
            </Group>
            <Group grow>
              <TextInput
                label="Publisher"
                value={form.publisher}
                onChange={(e) =>
                  setForm((f) => ({ ...f, publisher: e.currentTarget.value }))
                }
              />
              <TextInput
                label="Language"
                value={form.language}
                onChange={(e) =>
                  setForm((f) => ({ ...f, language: e.currentTarget.value }))
                }
              />
            </Group>
            <Group grow>
              <TextInput
                label="ISBN-10"
                value={form.isbn10}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isbn10: e.currentTarget.value }))
                }
              />
              <TextInput
                label="ISBN-13"
                value={form.isbn13}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isbn13: e.currentTarget.value }))
                }
              />
            </Group>
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.currentTarget.value }))
              }
              rows={3}
            />
            <Group>
              <Button
                onClick={() => void handleSave()}
                loading={saving}
                size="sm"
              >
                Save Metadata
              </Button>
            </Group>
            <Divider />
          </Stack>
        )}

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
