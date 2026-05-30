import { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Group,
  Button,
  Text,
  Loader,
  UnstyledButton,
  Breadcrumbs,
  Anchor,
} from '@mantine/core';
import { IconFolder, IconChevronRight } from '@tabler/icons-react';
import { api } from '../utils/api';

interface FolderEntry {
  name: string;
  relPath: string;
  hasChildren: boolean;
}

interface FolderBrowserModalProps {
  opened: boolean;
  onClose: () => void;
  onSelect: (relPath: string) => void;
  libraryRoot: string;
}

export function FolderBrowserModal({
  opened,
  onClose,
  onSelect,
  libraryRoot,
}: FolderBrowserModalProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setCurrentPath('');
    void loadPath('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  async function loadPath(relPath: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<FolderEntry[]>(
        `/admin/folders?path=${encodeURIComponent(relPath)}`,
      );
      setEntries(res.data);
      setCurrentPath(relPath);
    } catch {
      setError('Could not list folder contents.');
    } finally {
      setLoading(false);
    }
  }

  const breadcrumbs = currentPath
    ? ['', ...currentPath.split('/').filter(Boolean)]
    : [''];

  function handleBreadcrumb(idx: number) {
    const parts = currentPath.split('/').filter(Boolean);
    const newPath = parts.slice(0, idx).join('/');
    void loadPath(newPath);
  }

  function handleSelect() {
    onSelect(currentPath);
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Select Folder"
      size="md"
      centered
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
          Root: {libraryRoot}
        </Text>

        <Breadcrumbs separator="/">
          {breadcrumbs.map((part, idx) => (
            <Anchor
              key={idx}
              size="sm"
              onClick={() => handleBreadcrumb(idx)}
              style={{ cursor: 'pointer' }}
            >
              {idx === 0 ? '(root)' : part}
            </Anchor>
          ))}
        </Breadcrumbs>

        {loading ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
          </Group>
        ) : error ? (
          <Text c="red" size="sm">
            {error}
          </Text>
        ) : entries.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" p="md">
            No subdirectories here
          </Text>
        ) : (
          <Stack gap={4} style={{ maxHeight: 300, overflowY: 'auto' }}>
            {entries.map((entry) => (
              <UnstyledButton
                key={entry.relPath}
                onClick={() => void loadPath(entry.relPath)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 4,
                  background: 'transparent',
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
                <IconFolder size={16} />
                <Text size="sm" style={{ flex: 1 }}>
                  {entry.name}
                </Text>
                {entry.hasChildren && <IconChevronRight size={14} />}
              </UnstyledButton>
            ))}
          </Stack>
        )}

        <Group justify="space-between" mt="xs">
          <Button variant="default" onClick={onClose} size="sm">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSelect}>
            Select &quot;{currentPath || '(root)'}&quot;
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
