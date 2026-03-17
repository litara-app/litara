import { useState, useEffect, useRef } from 'react';
import {
  Modal,
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
  AspectRatio,
  Center,
  Button,
  Menu,
  TextInput,
  Loader,
  SimpleGrid,
  Divider,
  Stack,
  ActionIcon,
} from '@mantine/core';
import {
  IconBook2,
  IconDownload,
  IconChevronDown,
  IconArrowsJoin,
  IconCheck,
  IconSearch,
  IconX,
  IconPlus,
} from '@tabler/icons-react';
import { useSetAtom } from 'jotai';
import { librariesAtom, shelvesAtom } from '../store/atoms';
import { api } from '../utils/api';

const FORMAT_COLORS: Record<string, string> = {
  EPUB: 'green',
  MOBI: 'blue',
  AZW: 'orange',
  AZW3: 'yellow',
  CBZ: 'violet',
  PDF: 'red',
};

function formatBytes(sizeBytes: string): string {
  const n = Number(BigInt(sizeBytes));
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(1)} KB`;
}

interface BookFile {
  id: string;
  format: string;
  sizeBytes: string;
  filePath: string;
  missingAt: string | null;
}

interface BookDetail {
  id: string;
  title: string;
  description: string | null;
  isbn: string | null;
  publisher: string | null;
  publishedDate: string | null;
  language: string | null;
  pageCount: number | null;
  ageRating: string | null;
  hasCover: boolean;
  library: { id: string; name: string } | null;
  authors: string[];
  files: BookFile[];
  userReview: { rating: number | null; readStatus: string };
  shelves: { id: string; name: string }[];
}

interface Library {
  id: string;
  name: string;
}

interface Shelf {
  id: string;
  name: string;
}

interface BookSummary {
  id: string;
  title: string;
  authors: string[];
}

function MetaRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (!value && value !== 0) return null;
  return (
    <Box>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{String(value)}</Text>
    </Box>
  );
}

function FileRow({
  file,
  onDownload,
}: {
  file: BookFile;
  onDownload: (fileId: string) => void;
}) {
  const filename = file.filePath.split(/[\\/]/).pop() ?? file.filePath;
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Badge
          size="xs"
          color={FORMAT_COLORS[file.format] ?? 'gray'}
          radius="sm"
        >
          {file.format}
        </Badge>
        <Text size="xs" truncate style={{ flex: 1 }}>
          {filename}
        </Text>
        {file.missingAt && (
          <Badge size="xs" color="red" radius="sm">
            Missing
          </Badge>
        )}
      </Group>
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text size="xs" c="dimmed">
          {formatBytes(file.sizeBytes)}
        </Text>
        <ActionIcon
          size="xs"
          variant="subtle"
          disabled={!!file.missingAt}
          onClick={() => onDownload(file.id)}
          title="Download"
        >
          <IconDownload size={14} />
        </ActionIcon>
      </Group>
    </Group>
  );
}

export interface BookDetailModalProps {
  bookId: string | null;
  onClose: () => void;
  onBookUpdated: () => void;
}

export function BookDetailModal({
  bookId,
  onClose,
  onBookUpdated,
}: BookDetailModalProps) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [rating, setRating] = useState(0);
  const [readStatus, setReadStatus] = useState('UNREAD');
  const [libraryId, setLibraryId] = useState('');
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [addingLibrary, setAddingLibrary] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [selectedShelfIds, setSelectedShelfIds] = useState<string[]>([]);
  const [allShelves, setAllShelves] = useState<Shelf[]>([]);
  const [addingShelf, setAddingShelf] = useState(false);
  const [newShelfName, setNewShelfName] = useState('');
  const [savingShelf, setSavingShelf] = useState(false);
  const setLibrariesAtom = useSetAtom(librariesAtom);
  const setShelvesAtom = useSetAtom(shelvesAtom);

  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [matchQuery, setMatchQuery] = useState('');
  const [allBooks, setAllBooks] = useState<BookSummary[]>([]);
  const [matchCandidate, setMatchCandidate] = useState<BookSummary | null>(
    null,
  );
  const [matchConfirmOpen, setMatchConfirmOpen] = useState(false);
  const [matching, setMatching] = useState(false);

  const skipSaveRef = useRef(false);

  useEffect(() => {
    if (!bookId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setAddingLibrary(false);
    setAddingShelf(false);
    setNewLibraryName('');
    setNewShelfName('');
    Promise.all([
      api.get<BookDetail>(`/books/${bookId}`),
      api.get<Library[]>('/libraries'),
      api.get<Shelf[]>('/shelves'),
    ])
      .then(([bookRes, libsRes, shelvesRes]) => {
        const d = bookRes.data;
        setDetail(d);
        setRating(d.userReview.rating ?? 0);
        setReadStatus(d.userReview.readStatus);
        setLibraryId(d.library?.id ?? '');
        setLibraries(libsRes.data);
        setAllShelves(shelvesRes.data);
        setSelectedShelfIds(d.shelves.map((s) => s.id));
        skipSaveRef.current = true;
      })
      .finally(() => setLoading(false));
  }, [bookId]);

  // Auto-save rating + readStatus with 600ms debounce
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

  async function handleLibraryChange(value: string | null) {
    if (!value || !detail) return;
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
    if (!detail) return;
    await api.put(`/books/${detail.id}/shelves`, { shelfIds: ids });
  }

  async function handleCreateShelf() {
    if (!detail || !newShelfName.trim()) return;
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

  const librarySelectData = [
    ...libraries.map((l) => ({ value: l.id, label: l.name })),
    { value: '__add__', label: '＋ Add new library' },
  ];

  const filteredBooks = allBooks.filter((b) => {
    if (b.id === detail?.id) return false;
    const q = matchQuery.toLowerCase();
    if (!q) return true;
    return (
      b.title.toLowerCase().includes(q) ||
      b.authors.some((a) => a.toLowerCase().includes(q))
    );
  });

  const availableFiles = detail?.files ?? [];

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
        {loading || !detail ? (
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
            {/* X close button */}
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={onClose}
              style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}
              aria-label="Close"
            >
              <IconX size={18} />
            </ActionIcon>

            {/* Main content */}
            <Box style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left panel */}
              <Box
                style={{
                  width: 280,
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
                        width: '100%',
                        height: '100%',
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

              {/* Right panel */}
              <ScrollArea style={{ flex: 1 }} p="lg">
                <Box p="lg">
                  <Title order={2} mb={4}>
                    {detail.title}
                  </Title>
                  <Text size="sm" c="dimmed" mb="md">
                    {detail.authors.join(', ') || 'Unknown author'}
                  </Text>

                  {/* User data */}
                  <Paper withBorder p="md" radius="md" mb="md">
                    <Box
                      style={{
                        display: 'flex',
                        gap: 24,
                        alignItems: 'flex-start',
                      }}
                    >
                      {/* Right: Read Status, Library, Shelves */}
                      <Stack gap="xs" style={{ width: 200 }}>
                        {/* Left: Rating */}
                        <Box style={{ flexShrink: 0 }}>
                          <Text size="xs" c="dimmed" mb={4}>
                            Rating
                          </Text>
                          <Rating
                            value={rating}
                            onChange={setRating}
                            fractions={2}
                          />
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
                                  if (e.key === 'Enter')
                                    void handleCreateLibrary();
                                  if (e.key === 'Escape')
                                    setAddingLibrary(false);
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
                                onChange={(e) =>
                                  setNewShelfName(e.currentTarget.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter')
                                    void handleCreateShelf();
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
                                onChange={(ids) =>
                                  void handleShelvesChange(ids)
                                }
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
                    </Box>
                  </Paper>

                  {/* Synopsis */}
                  {detail.description && (
                    <>
                      <Text fw={600} mb={4}>
                        Synopsis
                      </Text>
                      <Text
                        size="sm"
                        mb="md"
                        style={{ whiteSpace: 'pre-wrap' }}
                      >
                        {detail.description}
                      </Text>
                    </>
                  )}

                  {/* Metadata */}
                  <Paper withBorder p="md" radius="md" mb="md">
                    <Text fw={600} mb="sm">
                      Details
                    </Text>
                    <SimpleGrid cols={2} spacing="sm">
                      <MetaRow label="ISBN" value={detail.isbn} />
                      <MetaRow label="Publisher" value={detail.publisher} />
                      <MetaRow
                        label="Published"
                        value={
                          detail.publishedDate
                            ? new Date(detail.publishedDate).getFullYear()
                            : null
                        }
                      />
                      <MetaRow label="Language" value={detail.language} />
                      <MetaRow label="Pages" value={detail.pageCount} />
                      <MetaRow label="Age Rating" value={detail.ageRating} />
                    </SimpleGrid>
                  </Paper>

                  {/* Files */}
                  {availableFiles.length > 0 && (
                    <Paper withBorder p="md" radius="md">
                      <Text fw={600} mb="sm">
                        Files
                      </Text>
                      <Box
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        {availableFiles.map((f) => (
                          <FileRow
                            key={f.id}
                            file={f}
                            onDownload={handleDownload}
                          />
                        ))}
                      </Box>
                    </Paper>
                  )}
                </Box>
              </ScrollArea>
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
                style={{
                  cursor: 'pointer',
                  borderRadius: 4,
                }}
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

      {/* Match confirmation dialog */}
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
          . The source book entry in database and its metadata will be
          permanently deleted. This cannot be undone.
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
