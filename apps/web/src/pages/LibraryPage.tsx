import { useState, useEffect, useCallback, useRef } from 'react';
import { useSetAtom, useAtomValue, useAtom } from 'jotai';
import {
  Title,
  Stack,
  Skeleton,
  Modal,
  TextInput,
  Button,
  Divider,
  Text,
  Group,
  ActionIcon,
  Indicator,
  Tooltip,
  Checkbox,
  Alert,
} from '@mantine/core';
import {
  IconFilter,
  IconCheckbox,
  IconRefresh,
  IconFolder,
} from '@tabler/icons-react';
import { LibraryIconPicker } from '../components/LibraryIconPicker';
import { FolderBrowserModal } from '../components/FolderBrowserModal';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { BookGrid } from '../components/BookGrid';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { PageHeader } from '../components/PageHeader';
import { BookFilterPanel } from '../components/BookFilterPanel';
import { useBookFilter } from '../hooks/useBookFilter';
import type { BookCardData } from '../components/BookCard';
import {
  librariesAtom,
  activeScanTasksAtom,
  userSettingsAtom,
  selectedBookIdsAtom,
  isSelectModeAtom,
} from '../store/atoms';
import type { Library } from '../store/atoms';
import { ITEM_MIN_WIDTHS } from '../utils/book-grid';
import { pushToast } from '../utils/toast';

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { saveScroll, restoreScroll, pathname } = useScrollRestoration();
  const [library, setLibrary] = useState<Library | null>(null);
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loadingLib, setLoadingLib] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const cancelRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIconKey, setEditIconKey] = useState<string | null>(null);
  const [editPath, setEditPath] = useState('');
  const [libraryRoot, setLibraryRoot] = useState('');
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBooksChecked, setDeleteBooksChecked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const setLibraries = useSetAtom(librariesAtom);
  const [activeScanTasks, setActiveScanTasks] = useAtom(activeScanTasksAtom);
  const [scanning, setScanning] = useState(false);
  const userSettings = useAtomValue(userSettingsAtom);
  const minWidth = ITEM_MIN_WIDTHS[userSettings.bookItemSize] ?? 160;
  const [selectedBookIds, setSelectedBookIds] = useAtom(selectedBookIdsAtom);
  const isSelectMode = useAtomValue(isSelectModeAtom);
  const [selectModeActive, setSelectModeActive] = useState(false);

  const {
    filters,
    setFilters,
    filteredBooks,
    panelOpen,
    setPanelOpen,
    activeCount,
    availableGenres,
    availableTags,
    availableFormats,
    availableMoods,
    availablePublishers,
    availableAuthors,
  } = useBookFilter(books);

  // Clear selection when library changes or filters change
  useEffect(() => {
    setSelectedBookIds(new Set());
    setSelectModeActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filters]);

  useEffect(() => {
    if (!isSelectMode) setSelectModeActive(false);
  }, [isSelectMode]);

  function toggleSelectMode() {
    if (selectModeActive) {
      setSelectModeActive(false);
      setSelectedBookIds(new Set());
    } else {
      setSelectModeActive(true);
    }
  }

  function handleToggleSelect(bookId: string) {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  function handleSelectAll() {
    const allIds = new Set(filteredBooks.map((b) => b.id));
    const allSelected = filteredBooks.every((b) => selectedBookIds.has(b.id));
    setSelectedBookIds(allSelected ? new Set() : allIds);
  }

  const BATCH_SIZE = 1000;

  const loadBooks = useCallback(async () => {
    if (!id) return;
    cancelRef.current = false;
    setLoadingBooks(true);
    setLoadingMore(false);

    try {
      let offset = 0;
      let accumulated: BookCardData[] = [];

      while (!cancelRef.current) {
        const res = await api.get<BookCardData[]>(
          `/books?libraryId=${id}&limit=${BATCH_SIZE}&offset=${offset}&sortBy=title&order=asc`,
        );
        if (cancelRef.current) break;

        const batch: BookCardData[] = res.data;
        accumulated = [...accumulated, ...batch];
        setBooks(accumulated);
        setLoadingBooks(false);

        if (batch.length < BATCH_SIZE) break;

        setLoadingMore(true);
        offset += BATCH_SIZE;
      }
    } finally {
      setLoadingBooks(false);
      setLoadingMore(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoadingLib(true);
    api
      .get<Library>(`/libraries/${id}`)
      .then((r) => {
        setLibrary(r.data);
        setEditName(r.data.name);
      })
      .finally(() => setLoadingLib(false));
    void loadBooks();
    return () => {
      cancelRef.current = true;
    };
  }, [id, loadBooks]);

  // Poll active scan task and re-fetch books as processed count advances
  useEffect(() => {
    if (!id) return;
    const taskId = activeScanTasks[id];
    if (!taskId) return;

    let lastProcessed = 0;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function stop() {
      cancelled = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function clearTask() {
      stop();
      setActiveScanTasks((prev) => {
        const next = { ...prev };
        delete next[id!];
        return next;
      });
      setScanning(false);
    }

    async function checkTask() {
      if (cancelled) return;
      try {
        const r = await api.get<{
          status: string;
          payload: { processed?: number; total?: number } | null;
        }>(`/admin/tasks/${taskId}`);
        if (cancelled) return;

        const processed = r.data.payload?.processed ?? 0;
        if (processed > lastProcessed) {
          lastProcessed = processed;
          void loadBooks();
        }
        if (r.data.status === 'COMPLETED') {
          clearTask();
          void loadBooks();
          pushToast('Library scan complete', { color: 'green' });
        } else if (r.data.status === 'FAILED') {
          clearTask();
          void loadBooks();
          pushToast('Library scan failed', { color: 'red' });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        if (status === 404) {
          clearTask();
        }
      }
    }

    // Start the interval synchronously so cleanup can always clear it, then
    // check immediately. A stale/terminal task is cleared on this first check
    // (via clearTask → stop) before the interval ever fires.
    intervalId = setInterval(() => void checkTask(), 2000);
    void checkTask();

    return () => stop();
  }, [id, activeScanTasks, loadBooks, setActiveScanTasks]);

  async function handleRescan() {
    if (!library) return;
    setScanning(true);
    try {
      const res = await api.post<{ taskId: string }>(
        `/libraries/${library.id}/scan`,
      );
      setActiveScanTasks((prev) => ({
        ...prev,
        [library.id]: res.data.taskId,
      }));
      pushToast('Scan started', { color: 'blue' });
    } catch {
      setScanning(false);
      pushToast('Failed to start scan', { color: 'red' });
    }
  }

  useEffect(() => {
    if (!loadingBooks) restoreScroll();
  }, [loadingBooks, restoreScroll]);

  function handleBookClick(bookId: string) {
    saveScroll();
    navigate(`/books/${bookId}`, { state: { from: pathname } });
  }

  function openSettings() {
    setEditName(library?.name ?? '');
    setEditIconKey(library?.iconKey ?? null);
    setEditPath(library?.path ?? '');
    setConfirmDelete(false);
    setSettingsOpen(true);
    if (!libraryRoot) {
      void api
        .get<{ libraryRoot: string }>('/setup/disk-status')
        .then((r) => setLibraryRoot(r.data.libraryRoot))
        .catch(() => {});
    }
  }

  async function handleSave() {
    if (!library || !editName.trim()) return;
    const trimmed = editName.trim();
    const nameUnchanged = trimmed === library.name;
    const iconUnchanged = (editIconKey ?? null) === (library.iconKey ?? null);
    const pathUnchanged = editPath.trim() === library.path;
    if (nameUnchanged && iconUnchanged && pathUnchanged) {
      setSettingsOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch<Library>(`/libraries/${library.id}`, {
        name: trimmed,
        iconKey: editIconKey ?? null,
        ...(pathUnchanged ? {} : { path: editPath.trim() }),
      });
      setLibrary(res.data);
      setLibraries((prev) =>
        prev.map((l) => (l.id === res.data.id ? res.data : l)),
      );
      pushToast('Library updated', { color: 'green' });
      setSettingsOpen(false);
    } finally {
      setSaving(false);
    }
  }

  function openDeleteConfirm() {
    setDeleteBooksChecked(false);
    setConfirmDelete(true);
  }

  function cancelDelete() {
    setConfirmDelete(false);
    setDeleteBooksChecked(false);
  }

  async function handleDelete() {
    if (!library) return;
    setDeleting(true);
    try {
      const params = deleteBooksChecked ? '?deleteBooks=true' : '';
      await api.delete(`/libraries/${library.id}${params}`);
      setLibraries((prev) => prev.filter((l) => l.id !== library.id));
      pushToast('Library deleted', { color: 'green' });
      navigate('/');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Stack>
      {loadingLib ? (
        <Skeleton height={36} width={200} radius="sm" />
      ) : (
        <PageHeader
          title={<Title order={2}>{library?.name}</Title>}
          onSettingsClick={openSettings}
          rightActions={
            <Group gap="xs">
              {selectModeActive && (
                <Button variant="subtle" size="xs" onClick={handleSelectAll}>
                  {filteredBooks.every((b) => selectedBookIds.has(b.id))
                    ? 'Deselect All'
                    : 'Select All'}
                </Button>
              )}
              <Tooltip label="Rescan library">
                <ActionIcon
                  variant="subtle"
                  size="md"
                  onClick={() => void handleRescan()}
                  loading={scanning}
                  aria-label="Rescan library"
                >
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>
              <ActionIcon
                variant={selectModeActive ? 'filled' : 'subtle'}
                size="md"
                onClick={toggleSelectMode}
                aria-label="Toggle select mode"
              >
                <IconCheckbox size={18} />
              </ActionIcon>
              <Indicator
                label={activeCount}
                disabled={activeCount === 0}
                size={16}
              >
                <ActionIcon
                  variant={panelOpen ? 'filled' : 'subtle'}
                  size="md"
                  onClick={() => setPanelOpen((v) => !v)}
                  aria-label="Toggle filters"
                >
                  <IconFilter size={18} />
                </ActionIcon>
              </Indicator>
            </Group>
          }
        />
      )}

      {loadingMore && (
        <Text size="xs" c="dimmed">
          Loading more books ({books.length.toLocaleString()} loaded)…
        </Text>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <BookGrid
            books={filteredBooks}
            loading={loadingBooks}
            minWidth={minWidth}
            skeletonCount={10}
            emptyMessage={
              activeCount > 0
                ? 'No books match the current filters.'
                : 'No books in this library yet.'
            }
            onBookClick={handleBookClick}
            onBookSend={handleBookClick}
            onBookRatingChange={(id, rating) =>
              setBooks((prev) =>
                prev.map((b) => (b.id === id ? { ...b, rating } : b)),
              )
            }
            isSelectMode={selectModeActive}
            selectedIds={selectedBookIds}
            onToggleSelect={handleToggleSelect}
          />
        </div>
        <div
          style={{
            width: panelOpen ? 280 : 0,
            overflow: 'hidden',
            transition: 'width 200ms ease',
            flexShrink: 0,
            alignSelf: 'flex-start',
          }}
        >
          <BookFilterPanel
            filters={filters}
            setFilters={setFilters}
            availableGenres={availableGenres}
            availableTags={availableTags}
            availableFormats={availableFormats}
            availableMoods={availableMoods}
            availablePublishers={availablePublishers}
            availableAuthors={availableAuthors}
            activeCount={activeCount}
          />
        </div>
      </div>

      <Modal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Library Settings"
        size="sm"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            value={editName}
            onChange={(e) => setEditName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
          />
          <LibraryIconPicker
            label="Icon"
            value={editIconKey}
            onChange={setEditIconKey}
          />
          <TextInput
            label="Folder Path"
            value={editPath}
            onChange={(e) => setEditPath(e.currentTarget.value)}
            description="Must be inside EBOOK_LIBRARY_PATH on the server."
            rightSectionWidth={100}
            rightSection={
              <Button
                size="xs"
                variant="light"
                leftSection={<IconFolder size={14} />}
                onClick={() => setFolderBrowserOpen(true)}
                style={{ marginRight: 4 }}
              >
                Browse
              </Button>
            }
          />
          <Button onClick={() => void handleSave()} loading={saving} fullWidth>
            Save
          </Button>
          <Divider />
          <FolderBrowserModal
            opened={folderBrowserOpen}
            onClose={() => setFolderBrowserOpen(false)}
            onSelect={(relPath) => {
              const root = libraryRoot.replace(/\/+$/, '');
              setEditPath(relPath ? `${root}/${relPath}` : libraryRoot);
            }}
            libraryRoot={libraryRoot}
          />
          {confirmDelete ? (
            <Stack gap="xs">
              <Checkbox
                label="Also permanently delete all books in this library"
                checked={deleteBooksChecked}
                onChange={(e) => setDeleteBooksChecked(e.currentTarget.checked)}
              />
              {deleteBooksChecked && (
                <Alert color="red" variant="light">
                  <Text size="sm">
                    This will permanently delete{' '}
                    <strong>
                      {library?.bookCount ?? 0} book
                      {(library?.bookCount ?? 0) !== 1 ? 's' : ''}
                    </strong>{' '}
                    along with all reading progress and annotations. This cannot
                    be undone.
                  </Text>
                </Alert>
              )}
              {!deleteBooksChecked && (
                <Text size="sm" c="dimmed">
                  Books will remain as orphaned books and can be reassigned to
                  another library.
                </Text>
              )}
              <Group grow>
                <Button variant="default" onClick={cancelDelete}>
                  Cancel
                </Button>
                <Button
                  color="red"
                  onClick={() => void handleDelete()}
                  loading={deleting}
                >
                  Confirm Delete
                </Button>
              </Group>
            </Stack>
          ) : (
            <Button
              color="red"
              variant="light"
              onClick={openDeleteConfirm}
              fullWidth
            >
              Delete Library
            </Button>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
