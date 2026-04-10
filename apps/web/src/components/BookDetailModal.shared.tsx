import { Group, Badge, Text, ActionIcon, Box, Tooltip } from '@mantine/core';
import { IconDownload, IconLock, IconLockOpen } from '@tabler/icons-react';
import type { BookFile } from './BookDetailModal.types';
import { FORMAT_COLORS } from './BookDetailModal.types';
import { formatBytes } from './BookDetailModal.utils';

export function FileRow({
  file,
  onDownload,
}: {
  file: BookFile;
  onDownload: (fileId: string) => void;
}) {
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
        <Text size="xs" truncate style={{ flex: 1 }} title={file.filePath}>
          {file.filePath}
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

export function LockButton({
  fieldName,
  locked,
  onToggle,
}: {
  fieldName: string;
  locked: boolean;
  onToggle: (field: string) => void;
}) {
  return (
    <Tooltip
      label={
        locked ? "Locked — won't be overwritten by metadata fetch" : 'Unlocked'
      }
      withArrow
    >
      <ActionIcon
        size="xs"
        variant="subtle"
        color={locked ? 'yellow' : 'gray'}
        onClick={() => onToggle(fieldName)}
      >
        {locked ? <IconLock size={16} /> : <IconLockOpen size={16} />}
      </ActionIcon>
    </Tooltip>
  );
}

export function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Box>
      <Text size="xs" c="dimmed" mb={2}>
        {label}
      </Text>
      <Text size="sm">{value ?? '—'}</Text>
    </Box>
  );
}
