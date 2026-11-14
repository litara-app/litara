import { useState } from 'react';
import {
  Box,
  Group,
  Text,
  Button,
  Popover,
  Menu,
  Modal,
  Stack,
  Transition,
} from '@mantine/core';
import {
  IconBookmark,
  IconTrash,
  IconCheck,
  IconX,
  IconChevronDown,
  IconMinus,
  IconSparkles,
} from '@tabler/icons-react';
import { useAtom, useAtomValue } from 'jotai';
import {
  selectedBookIdsAtom,
  isSelectModeAtom,
  shelvesAtom,
} from '../store/atoms';
import { api } from '../utils/api';
import { pushToast } from '../utils/toast';
import { useLocation } from 'react-router-dom';

interface BulkActionBarProps {
  onActionComplete?: () => void;
}

export function BulkActionBar({ onActionComplete }: BulkActionBarProps) {
  const [selectedBookIds, setSelectedBookIds] = useAtom(selectedBookIdsAtom);
  const isSelectMode = useAtomValue(isSelectModeAtom);
  const shelves = useAtomValue(shelvesAtom);
  const location = useLocation();

  const [loading, setLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const isAdmin = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') ?? '{}')?.role === 'ADMIN';
    } catch {
      return false;
    }
  })();

  const bookIds = Array.from(selectedBookIds);
  const count = bookIds.length;

  // Show "Remove from shelf" only when on a shelf page
  const shelfMatch = location.pathname.match(/^\/shelves\/([^/]+)/);
  const currentShelfId = shelfMatch ? shelfMatch[1] : null;

  function clearSelection() {
    setSelectedBookIds(new Set());
  }

  async function handleMarkRead() {
    setLoading(true);
    try {
      await api.patch('/books/bulk-reading-progress', {
        bookIds,
        action: 'mark-read',
      });
      pushToast(`Marked ${count} book${count !== 1 ? 's' : ''} as read`, {
        color: 'green',
      });
      clearSelection();
      onActionComplete?.();
    } catch {
      pushToast('Failed to update reading progress', { color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkUnread() {
    setLoading(true);
    try {
      await api.patch('/books/bulk-reading-progress', {
        bookIds,
        action: 'mark-unread',
      });
      pushToast(`Marked ${count} book${count !== 1 ? 's' : ''} as unread`, {
        color: 'green',
      });
      clearSelection();
      onActionComplete?.();
    } catch {
      pushToast('Failed to update reading progress', { color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  async function handleAddToShelf(shelfId: string, shelfName: string) {
    setLoading(true);
    try {
      await api.post(`/shelves/${shelfId}/books/bulk`, { bookIds });
      pushToast(
        `Added ${count} book${count !== 1 ? 's' : ''} to ${shelfName}`,
        { color: 'green' },
      );
      clearSelection();
      onActionComplete?.();
    } catch {
      pushToast('Failed to add to shelf', { color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveFromShelf() {
    if (!currentShelfId) return;
    setLoading(true);
    try {
      await api.delete(`/shelves/${currentShelfId}/books/bulk`, {
        data: { bookIds },
      });
      pushToast(`Removed ${count} book${count !== 1 ? 's' : ''} from shelf`, {
        color: 'green',
      });
      clearSelection();
      onActionComplete?.();
    } catch {
      pushToast('Failed to remove from shelf', { color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  async function handleChangeStatus(status: string, label: string) {
    setLoading(true);
    try {
      await api.patch('/books/bulk-status', { bookIds, status });
      pushToast(`Set ${count} book${count !== 1 ? 's' : ''} to ${label}`, {
        color: 'green',
      });
      clearSelection();
      onActionComplete?.();
    } catch {
      pushToast('Failed to change status', { color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoEnrich() {
    setLoading(true);
    try {
      const res = await api.post<{ taskId: string; total: number }>(
        '/admin/metadata-match/run',
        { scope: 'selection', bookIds, overwrite: false },
      );
      pushToast(
        `Enrichment started for ${res.data.total} book${res.data.total !== 1 ? 's' : ''} (task ${res.data.taskId.slice(0, 8)}…)`,
        { color: 'blue' },
      );
      clearSelection();
    } catch {
      pushToast('Failed to start enrichment', { color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      await api.delete('/books/bulk', { data: { bookIds } });
      pushToast(`Deleted ${count} book${count !== 1 ? 's' : ''}`, {
        color: 'green',
      });
      setDeleteConfirmOpen(false);
      clearSelection();
      onActionComplete?.();
    } catch {
      pushToast('Failed to delete books', { color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Transition mounted={isSelectMode} transition="slide-up" duration={200}>
        {(styles) => (
          <Box
            style={{
              ...styles,
              position: 'fixed',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 200,
              background: 'var(--mantine-color-dark-7)',
              border: '1px solid var(--mantine-color-dark-4)',
              borderRadius: 'var(--mantine-radius-md)',
              padding: '10px 16px',
              boxShadow: 'var(--mantine-shadow-xl)',
              minWidth: 480,
              maxWidth: '90vw',
            }}
          >
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {count} selected
              </Text>

              {/* Mark as read/unread */}
              <Menu shadow="md" position="top">
                <Menu.Target>
                  <Button
                    size="xs"
                    variant="light"
                    color="green"
                    leftSection={<IconCheck size={14} />}
                    rightSection={<IconChevronDown size={12} />}
                    loading={loading}
                    disabled={count === 0}
                  >
                    Mark
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconCheck size={14} />}
                    onClick={() => void handleMarkRead()}
                  >
                    Mark as Read
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconX size={14} />}
                    onClick={() => void handleMarkUnread()}
                  >
                    Mark as Unread
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>

              {/* Add to shelf */}
              {shelves.length > 0 && (
                <Popover position="top" shadow="md">
                  <Popover.Target>
                    <Button
                      size="xs"
                      variant="light"
                      color="blue"
                      leftSection={<IconBookmark size={14} />}
                      rightSection={<IconChevronDown size={12} />}
                      loading={loading}
                      disabled={count === 0}
                    >
                      Add to Shelf
                    </Button>
                  </Popover.Target>
                  <Popover.Dropdown p={4}>
                    <Stack gap={2}>
                      {shelves.map((shelf) => (
                        <Button
                          key={shelf.id}
                          variant="subtle"
                          size="xs"
                          fullWidth
                          justify="start"
                          onClick={() =>
                            void handleAddToShelf(shelf.id, shelf.name)
                          }
                        >
                          {shelf.name}
                        </Button>
                      ))}
                    </Stack>
                  </Popover.Dropdown>
                </Popover>
              )}

              {/* Remove from shelf (shelf pages only) */}
              {currentShelfId && (
                <Button
                  size="xs"
                  variant="light"
                  color="orange"
                  leftSection={<IconMinus size={14} />}
                  loading={loading}
                  disabled={count === 0}
                  onClick={() => void handleRemoveFromShelf()}
                >
                  Remove from Shelf
                </Button>
              )}

              {/* Change status */}
              <Menu shadow="md" position="top">
                <Menu.Target>
                  <Button
                    size="xs"
                    variant="light"
                    rightSection={<IconChevronDown size={12} />}
                    loading={loading}
                    disabled={count === 0}
                  >
                    Status
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    onClick={() =>
                      void handleChangeStatus('WANT_TO_READ', 'Want to Read')
                    }
                  >
                    Want to Read
                  </Menu.Item>
                  <Menu.Item
                    onClick={() =>
                      void handleChangeStatus('READING', 'Reading')
                    }
                  >
                    Reading
                  </Menu.Item>
                  <Menu.Item
                    onClick={() => void handleChangeStatus('READ', 'Read')}
                  >
                    Read
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>

              {/* Auto Enrich — admin only */}
              {isAdmin && (
                <Button
                  size="xs"
                  variant="light"
                  color="violet"
                  leftSection={<IconSparkles size={14} />}
                  loading={loading}
                  disabled={count === 0}
                  onClick={() => void handleAutoEnrich()}
                >
                  Auto Enrich
                </Button>
              )}

              {/* Delete — admin only */}
              {isAdmin && (
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  loading={loading}
                  disabled={count === 0}
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  Delete
                </Button>
              )}

              {/* Clear */}
              <Button
                size="xs"
                variant="subtle"
                c="dimmed"
                onClick={clearSelection}
              >
                Clear
              </Button>
            </Group>
          </Box>
        )}
      </Transition>

      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Books"
        size="sm"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Permanently delete <strong>{count}</strong> book
            {count !== 1 ? 's' : ''}? This cannot be undone.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={loading}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
