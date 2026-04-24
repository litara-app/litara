import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { librariesAtom, shelvesAtom } from '../store/atoms';
import {
  Modal,
  Paper,
  Box,
  AspectRatio,
  Center,
  Button,
  Menu,
  Loader,
  Divider,
  Group,
  Badge,
  ActionIcon,
  Tabs,
  Text,
  ScrollArea,
  TextInput,
  Alert,
  Select,
  MultiSelect,
  Rating,
  Stack,
  Progress,
  Tooltip,
  Checkbox,
} from '@mantine/core';
import {
  IconBook2,
  IconBook,
  IconDownload,
  IconChevronDown,
  IconArrowsJoin,
  IconCheck,
  IconSearch,
  IconX,
  IconLayoutList,
  IconPencil,
  IconFileText,
  IconSend,
  IconAlertTriangle,
  IconBookmarks,
  IconDatabaseImport,
  IconTrash,
  IconListNumbers,
  IconChevronLeft,
} from '@tabler/icons-react';
import axios from 'axios';
import { api } from '../utils/api';
import { useReadingQueueActions } from '../hooks/useReadingQueue';
import { pushToast } from '../utils/toast';
import type {
  BookDetail,
  BookSummary,
  EditedFields,
  Library,
  Shelf,
} from '../components/BookDetailModal.types';
import { FORMAT_COLORS } from '../components/BookDetailModal.types';
import { formatBytes } from '../components/BookDetailModal.utils';
import { OverviewTab } from '../components/OverviewTab';
import { EditMetadataTab } from '../components/EditMetadataTab';
import { SearchMetadataTab } from '../components/SearchMetadataTab';
import { SidecarTab } from '../components/SidecarTab';
import { BookAnnotationsTab } from '../components/BookAnnotationsTab';

function detailToEdited(d: BookDetail): EditedFields {
  return {
    title: d.title ?? '',
    subtitle: d.subtitle ?? '',
    description: d.description ?? '',
    isbn13: d.isbn13 ?? '',
    isbn10: d.isbn10 ?? '',
    publisher: d.publisher ?? '',
    publishedYear: d.publishedDate
      ? String(new Date(d.publishedDate).getUTCFullYear())
      : '',
    language: d.language ?? '',
    pageCount: d.pageCount ?? '',
    ageRating: d.ageRating ?? '',
    authors: d.authors,
    tags: d.tags,
    genres: d.genres,
    moods: d.moods,
    seriesName: d.series?.name ?? '',
    seriesPosition: d.series?.sequence ?? '',
    seriesTotalBooks: d.series?.totalBooks ?? '',
  };
}

export function BookDetailPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/books';
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  interface ProgressEntry {
    source: 'LITARA' | 'KOREADER';
    percentage: number | null;
  }
  const [readingProgress, setReadingProgress] = useState<ProgressEntry[]>([]);

  const [rating, setRating] = useState(0);
  const [readStatus, setReadStatus] = useState('UNREAD');
  const [libraryId, setLibraryId] = useState('');
  const libraries = useAtomValue(librariesAtom);
  const allShelves = useAtomValue(shelvesAtom);
  const setLibrariesAtom = useSetAtom(librariesAtom);
  const setShelvesAtom = useSetAtom(shelvesAtom);
  const [addingLibrary, setAddingLibrary] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [selectedShelfIds, setSelectedShelfIds] = useState<string[]>([]);
  const [addingShelf, setAddingShelf] = useState(false);
  const [newShelfName, setNewShelfName] = useState('');
  const [savingShelf, setSavingShelf] = useState(false);
  const skipSaveRef = useRef(true);

  const [editedFields, setEditedFields] = useState<EditedFields | null>(null);
  const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [diskSettings, setDiskSettings] = useState<{
    allowDiskWrites: boolean;
    isReadOnlyMount: boolean;
  } | null>(null);
  const [writingEpub, setWritingEpub] = useState(false);

  useEffect(() => {
    api
      .get<{ allowDiskWrites: boolean; isReadOnlyMount: boolean }>(
        '/admin/settings/disk',
      )
      .then((res) => setDiskSettings(res.data))
      .catch(() => {});
  }, []);

  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [recipientEmails, setRecipientEmails] = useState<
    { id: string; email: string; label: string | null; isDefault: boolean }[]
  >([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(
    null,
  );
  const [sendSizeWarning, setSendSizeWarning] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [matchQuery, setMatchQuery] = useState('');
  const [allBooks, setAllBooks] = useState<BookSummary[]>([]);
  const [matchCandidate, setMatchCandidate] = useState<BookSummary | null>(
    null,
  );
  const [matchConfirmOpen, setMatchConfirmOpen] = useState(false);
  const [matching, setMatching] = useState(false);

  const [resetProgressSource, setResetProgressSource] = useState<
    'LITARA' | 'KOREADER' | null
  >(null);
  const [resettingProgress, setResettingProgress] = useState(false);
  const [resetAudiobookProgressOpen, setResetAudiobookProgressOpen] =
    useState(false);
  const [resettingAudiobookProgress, setResettingAudiobookProgress] =
    useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const isAdmin = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') ?? '{}')?.role === 'ADMIN';
    } catch {
      return false;
    }
  })();
  const [deleting, setDeleting] = useState(false);

  const [inReadingQueue, setInReadingQueue] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const { addBook: addToQueue, removeBook: removeFromQueue } =
    useReadingQueueActions();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (
        matchModalOpen ||
        matchConfirmOpen ||
        deleteConfirmOpen ||
        sendModalOpen ||
        resetProgressSource !== null
      )
        return;
      navigate(from);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    navigate,
    from,
    matchModalOpen,
    matchConfirmOpen,
    deleteConfirmOpen,
    sendModalOpen,
    resetProgressSource,
  ]);

  useEffect(() => {
    if (!bookId) return;
    setLoading(true);
    setActiveTab('overview');
    setIsDirty(false);
    setReadingProgress([]);
    const prevRating = rating;
    const prevReadStatus = readStatus;
    Promise.all([
      api.get<BookDetail>(`/books/${bookId}`),
      api
        .get<ProgressEntry[]>(`/books/${bookId}/progress/all`)
        .catch(() => null),
    ])
      .then(([bookRes, progressRes]) => {
        const d = bookRes.data;
        setDetail(d);
        setEditedFields(detailToEdited(d));
        setLockedFields(new Set(d.lockedFields));
        const newRating = d.userReview.rating ?? 0;
        const newReadStatus = d.userReview.readStatus;
        skipSaveRef.current = true;
        setRating(newRating);
        setReadStatus(newReadStatus);
        if (newRating === prevRating && newReadStatus === prevReadStatus) {
          skipSaveRef.current = false;
        }
        setLibraryId(d.library?.id ?? '');
        setSelectedShelfIds(d.shelves.map((s) => s.id));
        setInReadingQueue(d.inReadingQueue);
        setReadingProgress(
          (progressRes?.data ?? []).filter((p) => p.percentage != null),
        );
      })
      .finally(() => setLoading(false));
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (!detail) return;
    const t = setTimeout(() => {
      void api.patch(`/books/${detail.id}`, { rating, readStatus });
    }, 600);
    return () => clearTimeout(t);
  }, [rating, readStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateField<K extends keyof EditedFields>(
    key: K,
    value: EditedFields[K],
  ) {
    setEditedFields((prev) => (prev ? { ...prev, [key]: value } : prev));
    setIsDirty(true);
  }

  function toggleLock(field: string) {
    setLockedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
    setIsDirty(true);
  }

  function handleSetLockedFields(v: Set<string>) {
    setLockedFields(v);
  }

  async function handleSave() {
    if (!detail || !editedFields) return;
    setSaving(true);
    try {
      const publishedDate = editedFields.publishedYear
        ? `${editedFields.publishedYear}-01-01`
        : undefined;

      await api.patch(`/books/${detail.id}`, {
        title: editedFields.title || undefined,
        subtitle: editedFields.subtitle || null,
        description: editedFields.description || null,
        isbn13: editedFields.isbn13 || null,
        isbn10: editedFields.isbn10 || null,
        publisher: editedFields.publisher || null,
        publishedDate: publishedDate ?? null,
        language: editedFields.language || null,
        pageCount:
          editedFields.pageCount !== '' ? Number(editedFields.pageCount) : null,
        ageRating: editedFields.ageRating || null,
        authors: editedFields.authors,
        tags: editedFields.tags,
        genres: editedFields.genres,
        moods: editedFields.moods,
        seriesName: editedFields.seriesName || null,
        seriesPosition:
          editedFields.seriesPosition !== ''
            ? Number(editedFields.seriesPosition)
            : null,
        seriesTotalBooks:
          editedFields.seriesTotalBooks !== ''
            ? Number(editedFields.seriesTotalBooks)
            : null,
        lockedFields: Array.from(lockedFields),
      });

      const res = await api.get<BookDetail>(`/books/${detail.id}`);
      setDetail(res.data);
      setEditedFields(detailToEdited(res.data));
      setLockedFields(new Set(res.data.lockedFields));
      setIsDirty(false);
      pushToast('Changes saved', { color: 'green' });
    } finally {
      setSaving(false);
    }
  }

  function handleApplied(updated: BookDetail) {
    setDetail(updated);
    setEditedFields(detailToEdited(updated));
    setLockedFields(new Set(updated.lockedFields));
    setIsDirty(false);
  }

  async function handleWriteEpub() {
    if (!detail) return;
    setWritingEpub(true);
    try {
      await api.post(`/books/${detail.id}/write-epub-metadata`);
      pushToast('Metadata written to epub file', { color: 'green' });
    } catch {
      pushToast('Failed to write metadata to epub', { color: 'red' });
    } finally {
      setWritingEpub(false);
    }
  }

  async function handleLibraryChange(value: string | null) {
    if (!detail || !value) return;
    if (value === '__add__') {
      setAddingLibrary(true);
      return;
    }
    setLibraryId(value);
    await api.patch(`/books/${detail.id}`, { libraryId: value });
  }

  async function handleCreateLibrary() {
    if (!detail || !newLibraryName.trim()) return;
    setSavingLibrary(true);
    try {
      const res = await api.post<Library>('/libraries', {
        name: newLibraryName.trim(),
      });
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
    if (!detail) return;
    setSelectedShelfIds(ids);
    await api.put(`/books/${detail.id}/shelves`, { shelfIds: ids });
  }

  async function handleCreateShelf() {
    if (!detail || !newShelfName.trim()) return;
    setSavingShelf(true);
    try {
      const res = await api.post<Shelf>('/shelves', {
        name: newShelfName.trim(),
      });
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

  async function handleToggleQueue() {
    if (!detail) return;
    setQueueLoading(true);
    try {
      if (inReadingQueue) {
        await removeFromQueue(detail.id);
        setInReadingQueue(false);
      } else {
        await addToQueue(detail.id);
        setInReadingQueue(true);
      }
    } finally {
      setQueueLoading(false);
    }
  }

  async function handleDownload(fileId: string) {
    if (!detail) return;
    const res = await api.get(`/books/${detail.id}/files/${fileId}/download`, {
      responseType: 'blob',
    });
    const cd: string = (res.headers['content-disposition'] as string) ?? '';
    const name = cd.match(/filename="([^"]+)"/)?.[1] ?? 'book';
    const url = URL.createObjectURL(res.data as Blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: decodeURIComponent(name),
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function openMatchModal() {
    setMatchModalOpen(true);
    setMatchQuery('');
    setMatchCandidate(null);
    const res = await api.get<BookSummary[]>('/books?limit=200');
    setAllBooks(res.data);
  }

  async function handleConfirmMatch() {
    if (!detail || !matchCandidate) return;
    setMatching(true);
    try {
      await api.post(`/books/${detail.id}/match`, {
        mergeFromId: matchCandidate.id,
      });
      setMatchConfirmOpen(false);
      setMatchModalOpen(false);
      navigate(from);
    } finally {
      setMatching(false);
    }
  }

  async function handleDeleteBook() {
    if (!detail) return;
    setDeleting(true);
    try {
      await api.delete(`/books/${detail.id}`, { data: { deleteFiles } });
      setDeleteConfirmOpen(false);
      navigate(from);
    } catch {
      pushToast('Failed to delete book', { color: 'red' });
    } finally {
      setDeleting(false);
    }
  }

  async function handleResetProgress(source: 'LITARA' | 'KOREADER') {
    if (!detail) return;
    setResettingProgress(true);
    try {
      await api.delete(`/books/${detail.id}/progress?source=${source}`);
      setReadingProgress((prev) => prev.filter((p) => p.source !== source));
      setResetProgressSource(null);
      pushToast('Reading progress cleared', { color: 'green' });
    } catch {
      pushToast('Failed to clear progress', { color: 'red' });
    } finally {
      setResettingProgress(false);
    }
  }

  async function handleResetAudiobookProgress() {
    if (!detail) return;
    setResettingAudiobookProgress(true);
    try {
      await api.delete(`/audiobooks/${detail.id}/progress`);
      setDetail((prev) => (prev ? { ...prev, audiobookProgress: null } : prev));
      setResetAudiobookProgressOpen(false);
      pushToast('Audiobook progress cleared', { color: 'green' });
    } catch {
      pushToast('Failed to clear audiobook progress', { color: 'red' });
    } finally {
      setResettingAudiobookProgress(false);
    }
  }

  const SEND_SIZE_THRESHOLD = 25 * 1024 * 1024;

  function resolveDefaultSendFile(
    files: BookDetail['files'],
  ): BookDetail['files'][0] | undefined {
    const READABLE = ['EPUB', 'MOBI', 'AZW', 'AZW3'];
    return (
      files.find((f) => READABLE.includes(f.format.toUpperCase())) ?? files[0]
    );
  }

  async function openSendModal() {
    if (!detail) return;
    setSendError('');
    setSendSizeWarning(false);

    const [recipientsRes] = await Promise.all([
      api.get<
        {
          id: string;
          email: string;
          label: string | null;
          isDefault: boolean;
        }[]
      >('/users/me/recipient-emails'),
    ]);
    setRecipientEmails(recipientsRes.data);

    const defaultFile = resolveDefaultSendFile(detail.files);
    setSelectedFileId(defaultFile?.id ?? null);

    const defaultRecipient = recipientsRes.data.find((r) => r.isDefault);
    setSelectedRecipientId(
      defaultRecipient?.id ?? recipientsRes.data[0]?.id ?? null,
    );

    setSendModalOpen(true);
  }

  async function handleSend(confirmed = false) {
    if (!detail) return;

    const file = detail.files.find((f) => f.id === selectedFileId);
    const sizeBytes = file ? parseInt(file.sizeBytes, 10) : 0;
    if (!confirmed && !isNaN(sizeBytes) && sizeBytes > SEND_SIZE_THRESHOLD) {
      setSendSizeWarning(true);
      return;
    }

    setSending(true);
    setSendError('');
    try {
      await api.post(`/books/${detail.id}/send`, {
        fileId: selectedFileId ?? undefined,
        recipientEmailId: selectedRecipientId ?? undefined,
      });
      setSendModalOpen(false);
      setSendSizeWarning(false);
      pushToast('Book sent successfully', { color: 'green' });
    } catch (e) {
      const msg =
        axios.isAxiosError(e) &&
        (e.response?.data as { message?: string })?.message;
      setSendError(typeof msg === 'string' ? msg : 'Failed to send book.');
    } finally {
      setSending(false);
    }
  }

  const availableFiles = detail?.files ?? [];

  const filteredBooks = allBooks.filter((b) => {
    if (b.id === detail?.id) return false;
    const q = matchQuery.toLowerCase();
    if (!q) return true;
    return (
      b.title.toLowerCase().includes(q) ||
      b.authors.some((a) => a.toLowerCase().includes(q))
    );
  });

  return (
    <>
      <Paper
        withBorder
        radius="md"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height:
            'calc(100dvh - var(--app-shell-header-height) - var(--app-shell-padding) * 2)',
          overflow: 'hidden',
        }}
      >
        {/* Back navigation */}
        <Group
          px="md"
          py="xs"
          style={{
            borderBottom: '1px solid var(--mantine-color-default-border)',
            flexShrink: 0,
          }}
        >
          <Button
            variant="subtle"
            leftSection={<IconChevronLeft size={16} />}
            onClick={() => navigate(from)}
            size="sm"
            px="xs"
          >
            Back
          </Button>
        </Group>

        {loading || !detail || !editedFields ? (
          <Center style={{ flex: 1 }}>
            <Loader />
          </Center>
        ) : (
          <>
            <Box style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left panel */}
              <Box
                style={{
                  width: 260,
                  flexShrink: 0,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  borderRight: '1px solid var(--mantine-color-gray-3)',
                  overflowY: 'auto',
                }}
              >
                <AspectRatio ratio={2 / 3}>
                  {detail.hasCover ? (
                    <img
                      src={`/api/v1/books/${detail.id}/cover?v=${detail.coverUpdatedAt}`}
                      alt={detail.title}
                      style={{
                        objectFit: 'cover',
                        borderRadius: 8,
                        width: '100%',
                        height: '100%',
                      }}
                    />
                  ) : (
                    <Center
                      style={{
                        background: 'var(--mantine-color-gray-1)',
                        borderRadius: 8,
                      }}
                    >
                      <IconBook2
                        size={48}
                        color="var(--mantine-color-gray-5)"
                      />
                    </Center>
                  )}
                </AspectRatio>
                <Group gap={4} wrap="wrap">
                  {detail.files.map((f) => (
                    <Badge
                      key={f.id}
                      size="sm"
                      color={FORMAT_COLORS[f.format] ?? 'gray'}
                      radius="sm"
                    >
                      {f.format}
                    </Badge>
                  ))}
                </Group>
                {detail.files.some(
                  (f) =>
                    ['EPUB', 'MOBI', 'AZW', 'AZW3', 'CBZ'].includes(f.format) &&
                    !f.missingAt,
                ) && (
                  <Stack gap={6}>
                    <Button
                      fullWidth
                      leftSection={<IconBook size={16} />}
                      onClick={() => navigate(`/read/${detail.id}`)}
                    >
                      Read
                    </Button>
                    {readingProgress.length > 0 && (
                      <Stack gap={6}>
                        {readingProgress.map((p) => {
                          const pct = p.percentage ?? 0;
                          const label =
                            p.source === 'KOREADER' ? 'KOReader' : 'Litara';
                          const color =
                            p.source === 'KOREADER' ? 'blue' : 'green';
                          return (
                            <Box key={p.source}>
                              <Progress
                                value={pct * 100}
                                size="sm"
                                color={color}
                                radius="xs"
                              />
                              <Group
                                justify="space-between"
                                align="center"
                                mt={2}
                              >
                                <Text size="xs" c="dimmed">
                                  {label}:{' '}
                                  {detail.pageCount
                                    ? `~${Math.round(pct * detail.pageCount)} / ${detail.pageCount} pages`
                                    : `${Math.round(pct * 100)}%`}
                                </Text>
                                <Tooltip
                                  label={`Clear ${label} progress`}
                                  withArrow
                                >
                                  <ActionIcon
                                    size="xs"
                                    variant="subtle"
                                    color="red"
                                    onClick={() =>
                                      setResetProgressSource(p.source)
                                    }
                                  >
                                    <IconX size={12} />
                                  </ActionIcon>
                                </Tooltip>
                              </Group>
                            </Box>
                          );
                        })}
                      </Stack>
                    )}
                  </Stack>
                )}
                {detail.hasAudiobook &&
                  detail.audiobookProgress &&
                  (() => {
                    const prog = detail.audiobookProgress;
                    const totalDuration = detail.audiobookFiles.reduce(
                      (s, f) => s + f.duration,
                      0,
                    );
                    const precedingDuration = detail.audiobookFiles
                      .filter((f) => f.fileIndex < prog.currentFileIndex)
                      .reduce((s, f) => s + f.duration, 0);
                    const absoluteTime = precedingDuration + prog.currentTime;
                    const fraction =
                      totalDuration > 0
                        ? Math.min(1, absoluteTime / totalDuration)
                        : 0;
                    const formatTime = (sec: number) => {
                      const h = Math.floor(sec / 3600);
                      const m = Math.floor((sec % 3600) / 60);
                      if (h > 0) return `${h}h ${m}m`;
                      return `${m}m`;
                    };
                    return (
                      <Stack gap={6}>
                        <Progress
                          value={fraction * 100}
                          size="sm"
                          color="teal"
                          radius="xs"
                        />
                        <Group justify="space-between" align="center">
                          <Text size="xs" c="dimmed">
                            {formatTime(absoluteTime)} /{' '}
                            {formatTime(totalDuration)}
                          </Text>
                          <Tooltip label="Reset audiobook progress" withArrow>
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="red"
                              onClick={() =>
                                setResetAudiobookProgressOpen(true)
                              }
                            >
                              <IconX size={12} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Stack>
                    );
                  })()}
                <Divider />
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
                          onChange={(e) =>
                            setNewLibraryName(e.currentTarget.value)
                          }
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
                        data={[
                          ...libraries.map((l) => ({
                            value: l.id,
                            label: l.name,
                          })),
                          { value: '__add__', label: '＋ Add new library' },
                        ]}
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
                          onChange={(e) =>
                            setNewShelfName(e.currentTarget.value)
                          }
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
                      <MultiSelect
                        value={selectedShelfIds}
                        onChange={(ids) => {
                          if (ids.includes('__add__')) {
                            setAddingShelf(true);
                            return;
                          }
                          void handleShelvesChange(ids);
                        }}
                        data={[
                          ...allShelves.map((s) => ({
                            value: s.id,
                            label: s.name,
                          })),
                          { value: '__add__', label: '＋ New shelf' },
                        ]}
                        placeholder="Add to shelf..."
                        size="xs"
                        clearable
                      />
                    )}
                  </Box>

                  {/* Reading Queue */}
                  <Box>
                    <Button
                      size="xs"
                      variant={inReadingQueue ? 'filled' : 'default'}
                      color={inReadingQueue ? 'blue' : undefined}
                      leftSection={<IconListNumbers size={14} />}
                      loading={queueLoading}
                      fullWidth
                      onClick={() => void handleToggleQueue()}
                    >
                      {inReadingQueue ? 'In Reading Queue' : 'Add to Queue'}
                    </Button>
                  </Box>
                </Stack>
              </Box>

              {/* Right panel — tabs */}
              <Tabs
                value={activeTab}
                onChange={(v) => v && setActiveTab(v)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <Tabs.List px="lg" pt="sm" style={{ flexShrink: 0 }}>
                  <Tabs.Tab
                    value="overview"
                    leftSection={<IconLayoutList size={14} />}
                  >
                    Overview
                  </Tabs.Tab>
                  <Tabs.Tab value="edit" leftSection={<IconPencil size={14} />}>
                    Edit Metadata
                  </Tabs.Tab>
                  <Tabs.Tab
                    value="search"
                    leftSection={<IconSearch size={14} />}
                  >
                    Search Metadata
                  </Tabs.Tab>
                  <Tabs.Tab
                    value="sidecar"
                    leftSection={<IconFileText size={14} />}
                  >
                    Sidecar
                  </Tabs.Tab>
                  <Tabs.Tab
                    value="annotations"
                    leftSection={<IconBookmarks size={14} />}
                  >
                    Annotations
                  </Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel
                  value="overview"
                  style={{ flex: 1, overflow: 'hidden' }}
                >
                  <OverviewTab
                    key={detail.id}
                    detail={detail}
                    onDownload={handleDownload}
                    onViewSeries={(seriesId) =>
                      navigate(`/series/${seriesId}`, {
                        state: { from: location.pathname },
                      })
                    }
                    onOpenBook={(id) =>
                      navigate(`/books/${id}`, { state: { from } })
                    }
                  />
                </Tabs.Panel>

                <Tabs.Panel
                  value="edit"
                  style={{ flex: 1, overflow: 'hidden' }}
                >
                  <EditMetadataTab
                    editedFields={editedFields}
                    lockedFields={lockedFields}
                    updateField={updateField}
                    toggleLock={toggleLock}
                    setLockedFields={handleSetLockedFields}
                    setIsDirty={setIsDirty}
                  />
                </Tabs.Panel>

                <Tabs.Panel
                  value="search"
                  style={{ flex: 1, overflow: 'hidden' }}
                >
                  <SearchMetadataTab
                    key={detail.id}
                    detail={detail}
                    lockedFields={lockedFields}
                    onSearch={(provider, params) =>
                      api
                        .get<
                          import('../components/BookDetailModal.types').MetadataResult[]
                        >(
                          `/books/${detail.id}/search-metadata?provider=${provider}&${params.toString()}`,
                        )
                        .then((r) => r.data ?? [])
                        .catch(() => [])
                    }
                    onApply={async (payload) => {
                      await api.patch(`/books/${detail.id}`, payload);
                      const res = await api.get<BookDetail>(
                        `/books/${detail.id}`,
                      );
                      handleApplied(res.data);
                    }}
                    onSwitchTab={setActiveTab}
                  />
                </Tabs.Panel>
                <Tabs.Panel
                  value="sidecar"
                  style={{ flex: 1, overflow: 'hidden' }}
                >
                  {detail && (
                    <SidecarTab
                      key={detail.id}
                      bookId={detail.id}
                      detail={detail}
                      lockedFields={lockedFields}
                      onApplied={handleApplied}
                      onSwitchTab={setActiveTab}
                    />
                  )}
                </Tabs.Panel>
                <Tabs.Panel
                  value="annotations"
                  style={{ flex: 1, overflow: 'hidden', padding: '12px 24px' }}
                >
                  {detail && (
                    <BookAnnotationsTab
                      key={detail.id}
                      bookId={detail.id}
                      onClose={() => navigate(-1)}
                    />
                  )}
                </Tabs.Panel>
              </Tabs>
            </Box>

            {/* Action bar */}
            <Divider />
            <Box
              style={{
                padding: '12px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Group gap="sm">
                <Button
                  variant="light"
                  leftSection={<IconArrowsJoin size={16} />}
                  onClick={() => void openMatchModal()}
                >
                  Match Book
                </Button>

                {availableFiles.length === 1 ? (
                  <Button
                    leftSection={<IconDownload size={16} />}
                    disabled={!!availableFiles[0].missingAt}
                    onClick={() => void handleDownload(availableFiles[0].id)}
                  >
                    Download
                  </Button>
                ) : availableFiles.length > 1 ? (
                  <Menu>
                    <Menu.Target>
                      <Button
                        leftSection={<IconDownload size={16} />}
                        rightSection={<IconChevronDown size={14} />}
                      >
                        Download
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {availableFiles.map((f) => (
                        <Menu.Item
                          key={f.id}
                          disabled={!!f.missingAt}
                          leftSection={
                            <Badge
                              size="xs"
                              color={FORMAT_COLORS[f.format] ?? 'gray'}
                              radius="sm"
                            >
                              {f.format}
                            </Badge>
                          }
                          onClick={() => void handleDownload(f.id)}
                        >
                          {formatBytes(f.sizeBytes)}
                          {f.missingAt ? ' (missing)' : ''}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                ) : null}

                {detail && detail.files.length > 0 && (
                  <Button
                    variant="light"
                    leftSection={<IconSend size={16} />}
                    onClick={() => void openSendModal()}
                  >
                    Send
                  </Button>
                )}

                {isDirty && (
                  <Button
                    leftSection={<IconCheck size={16} />}
                    loading={saving}
                    onClick={() => void handleSave()}
                  >
                    Save Changes
                  </Button>
                )}

                {detail &&
                  detail.files.some((f) => f.format === 'EPUB') &&
                  diskSettings !== null && (
                    <Tooltip
                      label={
                        !diskSettings.allowDiskWrites
                          ? 'Enable disk writes in Admin → Disk Settings'
                          : diskSettings.isReadOnlyMount
                            ? 'Library directory is read-only'
                            : 'Write current metadata to the epub file on disk'
                      }
                    >
                      <span>
                        <Button
                          color="yellow"
                          variant="light"
                          leftSection={<IconDatabaseImport size={16} />}
                          loading={writingEpub}
                          disabled={
                            !diskSettings.allowDiskWrites ||
                            diskSettings.isReadOnlyMount
                          }
                          onClick={() => void handleWriteEpub()}
                        >
                          Write to File
                        </Button>
                      </span>
                    </Tooltip>
                  )}
              </Group>
              <Group gap="sm">
                {isAdmin && (
                  <Button
                    color="red"
                    variant="light"
                    leftSection={<IconTrash size={16} />}
                    onClick={() => {
                      setDeleteFiles(false);
                      setDeleteConfirmOpen(true);
                    }}
                  >
                    Delete Book
                  </Button>
                )}
              </Group>
            </Box>
          </>
        )}
      </Paper>

      {/* Match Book modal */}
      <Modal
        opened={matchModalOpen}
        onClose={() => setMatchModalOpen(false)}
        title="Match Book"
        size="lg"
      >
        <TextInput
          placeholder="Search by title or author..."
          leftSection={<IconSearch size={14} />}
          value={matchQuery}
          onChange={(e) => setMatchQuery(e.currentTarget.value)}
          mb="sm"
        />
        <ScrollArea h={360}>
          {filteredBooks.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="lg">
              No books found
            </Text>
          ) : (
            filteredBooks.map((b) => (
              <Box
                key={b.id}
                p="xs"
                style={{ cursor: 'pointer', borderRadius: 4 }}
                onClick={() => {
                  setMatchCandidate(b);
                  setMatchConfirmOpen(true);
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    'var(--mantine-color-gray-1)')
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    'transparent')
                }
              >
                <Text size="sm" fw={500}>
                  {b.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {b.authors.join(', ') || 'Unknown'}
                </Text>
              </Box>
            ))
          )}
        </ScrollArea>
      </Modal>

      {/* Match confirmation */}
      <Modal
        opened={matchConfirmOpen}
        onClose={() => setMatchConfirmOpen(false)}
        title="Confirm Match"
        size="sm"
      >
        <Text size="sm" mb="md">
          Move all files from{' '}
          <Text component="span" fw={600}>
            "{matchCandidate?.title}"
          </Text>{' '}
          into{' '}
          <Text component="span" fw={600}>
            "{detail?.title}"
          </Text>
          . The source book entry will be permanently deleted. This cannot be
          undone.
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={() => setMatchConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={matching}
            onClick={() => void handleConfirmMatch()}
          >
            Confirm
          </Button>
        </Group>
      </Modal>

      {/* Clear reading progress confirmation */}
      <Modal
        opened={resetProgressSource !== null}
        onClose={() => setResetProgressSource(null)}
        title="Clear Reading Progress"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Clear{' '}
            <Text component="span" fw={600}>
              {resetProgressSource === 'KOREADER' ? 'KOReader' : 'Litara'}
            </Text>{' '}
            progress for{' '}
            <Text component="span" fw={600}>
              "{detail?.title}"
            </Text>
            ? This cannot be undone.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="subtle"
              onClick={() => setResetProgressSource(null)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={resettingProgress}
              onClick={() =>
                resetProgressSource &&
                void handleResetProgress(resetProgressSource)
              }
            >
              Clear
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Reset audiobook progress confirmation */}
      <Modal
        opened={resetAudiobookProgressOpen}
        onClose={() => setResetAudiobookProgressOpen(false)}
        title="Reset Audiobook Progress"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Reset audiobook progress for{' '}
            <Text component="span" fw={600}>
              "{detail?.title}"
            </Text>
            ? This cannot be undone.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="subtle"
              onClick={() => setResetAudiobookProgressOpen(false)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={resettingAudiobookProgress}
              onClick={() => void handleResetAudiobookProgress()}
            >
              Reset
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Book"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Permanently delete{' '}
            <Text component="span" fw={600}>
              "{detail?.title}"
            </Text>{' '}
            from the database. This cannot be undone.
          </Text>
          <Checkbox
            label="Also delete files from filesystem"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.currentTarget.checked)}
            disabled={
              !diskSettings?.allowDiskWrites || diskSettings?.isReadOnlyMount
            }
          />
          {deleteFiles && (
            <Alert
              icon={<IconAlertTriangle size={14} />}
              color="red"
              variant="light"
            >
              The ebook files on disk will be permanently deleted.
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button
              variant="subtle"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={deleting}
              onClick={() => void handleDeleteBook()}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Send Book modal */}
      <Modal
        opened={sendModalOpen}
        onClose={() => {
          setSendModalOpen(false);
          setSendSizeWarning(false);
          setSendError('');
        }}
        title="Send Book"
        size="sm"
      >
        <Stack gap="sm">
          {detail && detail.files.length > 1 && (
            <Select
              label="Format"
              value={selectedFileId}
              onChange={(v) => {
                setSelectedFileId(v);
                setSendSizeWarning(false);
              }}
              data={detail.files.map((f) => ({
                value: f.id,
                label: `${f.format} — ${formatBytes(f.sizeBytes)}${f.missingAt ? ' (missing)' : ''}`,
                disabled: !!f.missingAt,
              }))}
            />
          )}

          {recipientEmails.length === 0 ? (
            <Alert
              icon={<IconAlertTriangle size={14} />}
              color="yellow"
              variant="light"
            >
              No recipient emails configured. Add one in Account settings.
            </Alert>
          ) : (
            <Select
              label="Send to"
              value={selectedRecipientId}
              onChange={setSelectedRecipientId}
              data={recipientEmails.map((r) => ({
                value: r.id,
                label: r.label ? `${r.label} (${r.email})` : r.email,
              }))}
            />
          )}

          {sendSizeWarning && (
            <Alert
              icon={<IconAlertTriangle size={14} />}
              color="orange"
              variant="light"
            >
              {(() => {
                const file = detail?.files.find((f) => f.id === selectedFileId);
                const mb = file
                  ? (parseInt(file.sizeBytes, 10) / (1024 * 1024)).toFixed(1)
                  : '?';
                return `This file is ${mb} MB. Some SMTP servers (e.g. Gmail) reject attachments larger than 25 MB.`;
              })()}
            </Alert>
          )}

          {sendError && (
            <Alert
              icon={<IconAlertTriangle size={14} />}
              color="red"
              variant="light"
            >
              {sendError}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm" mt="xs">
            <Button
              variant="subtle"
              onClick={() => {
                setSendModalOpen(false);
                setSendSizeWarning(false);
                setSendError('');
              }}
            >
              Cancel
            </Button>
            {sendSizeWarning ? (
              <Button
                color="orange"
                loading={sending}
                onClick={() => void handleSend(true)}
              >
                Send anyway
              </Button>
            ) : (
              <Button
                leftSection={<IconSend size={14} />}
                loading={sending}
                disabled={!selectedRecipientId || recipientEmails.length === 0}
                onClick={() => void handleSend()}
              >
                Send
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
