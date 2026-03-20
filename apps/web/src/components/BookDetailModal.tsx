import { useState, useEffect } from 'react';
import {
  Modal,
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
} from '@mantine/core';
import {
  IconBook2,
  IconDownload,
  IconChevronDown,
  IconArrowsJoin,
  IconCheck,
  IconSearch,
  IconX,
  IconLayoutList,
  IconPencil,
  IconFileText,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import { pushToast } from '../utils/toast';
import type {
  BookDetail,
  BookSummary,
  EditedFields,
} from './BookDetailModal.types';
import { FORMAT_COLORS } from './BookDetailModal.types';
import { formatBytes } from './BookDetailModal.utils';
import { OverviewTab } from './OverviewTab';
import { EditMetadataTab } from './EditMetadataTab';
import { SearchMetadataTab } from './SearchMetadataTab';
import { SidecarTab } from './SidecarTab';

export interface BookDetailModalProps {
  bookId: string | null;
  onClose: () => void;
  onBookUpdated: () => void;
}

function detailToEdited(d: BookDetail): EditedFields {
  return {
    title: d.title ?? '',
    subtitle: d.subtitle ?? '',
    description: d.description ?? '',
    isbn13: d.isbn13 ?? '',
    isbn10: d.isbn10 ?? '',
    publisher: d.publisher ?? '',
    publishedYear: d.publishedDate
      ? String(new Date(d.publishedDate).getFullYear())
      : '',
    language: d.language ?? '',
    pageCount: d.pageCount ?? '',
    ageRating: d.ageRating ?? '',
    authors: d.authors,
    tags: d.tags,
    genres: d.genres,
    moods: d.moods,
    seriesName: d.series?.name ?? '',
    seriesSequence: d.series?.sequence ?? '',
    seriesTotalBooks: d.series?.totalBooks ?? '',
  };
}

export function BookDetailModal({
  bookId,
  onClose,
  onBookUpdated,
}: BookDetailModalProps) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const [editedFields, setEditedFields] = useState<EditedFields | null>(null);
  const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Match book
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [matchQuery, setMatchQuery] = useState('');
  const [allBooks, setAllBooks] = useState<BookSummary[]>([]);
  const [matchCandidate, setMatchCandidate] = useState<BookSummary | null>(
    null,
  );
  const [matchConfirmOpen, setMatchConfirmOpen] = useState(false);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    if (!bookId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setActiveTab('overview');
    setIsDirty(false);
    api
      .get<BookDetail>(`/books/${bookId}`)
      .then((res) => {
        const d = res.data;
        setDetail(d);
        setEditedFields(detailToEdited(d));
        setLockedFields(new Set(d.lockedFields));
      })
      .finally(() => setLoading(false));
  }, [bookId]);

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
        subtitle: editedFields.subtitle || undefined,
        description: editedFields.description || undefined,
        isbn13: editedFields.isbn13 || undefined,
        isbn10: editedFields.isbn10 || undefined,
        publisher: editedFields.publisher || undefined,
        publishedDate,
        language: editedFields.language || undefined,
        pageCount:
          editedFields.pageCount !== ''
            ? Number(editedFields.pageCount)
            : undefined,
        ageRating: editedFields.ageRating || undefined,
        authors: editedFields.authors,
        tags: editedFields.tags,
        genres: editedFields.genres,
        moods: editedFields.moods,
        seriesName: editedFields.seriesName || null,
        seriesSequence:
          editedFields.seriesSequence !== ''
            ? Number(editedFields.seriesSequence)
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
      onBookUpdated();
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
    onBookUpdated();
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
      onBookUpdated();
      onClose();
    } finally {
      setMatching(false);
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
      <Modal
        opened={!!bookId}
        onClose={onClose}
        fullScreen
        padding={0}
        withCloseButton={false}
        title={null}
      >
        {loading || !detail || !editedFields ? (
          <Center style={{ height: '100vh' }}>
            <Loader />
          </Center>
        ) : (
          <Box
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100vh',
            }}
          >
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={onClose}
              style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}
              aria-label="Close"
            >
              <IconX size={18} />
            </ActionIcon>

            <Box style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left panel — cover */}
              <Box
                style={{
                  width: 260,
                  flexShrink: 0,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  borderRight: '1px solid var(--mantine-color-gray-3)',
                }}
              >
                <AspectRatio ratio={2 / 3}>
                  {detail.hasCover ? (
                    <img
                      src={`/api/v1/books/${detail.id}/cover`}
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
                </Tabs.List>

                <Tabs.Panel
                  value="overview"
                  style={{ flex: 1, overflow: 'hidden' }}
                >
                  <OverviewTab
                    key={detail.id}
                    detail={detail}
                    onDownload={handleDownload}
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
                    bookId={detail.id}
                    detail={detail}
                    lockedFields={lockedFields}
                    onApplied={handleApplied}
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

                {isDirty && (
                  <Button
                    leftSection={<IconCheck size={16} />}
                    loading={saving}
                    onClick={() => void handleSave()}
                  >
                    Save Changes
                  </Button>
                )}
              </Group>
              <Button variant="subtle" onClick={onClose}>
                Close
              </Button>
            </Box>
          </Box>
        )}
      </Modal>

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
    </>
  );
}
