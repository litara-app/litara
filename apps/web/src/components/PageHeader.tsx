import { Group, Title, ActionIcon } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';

interface PageHeaderProps {
  title: React.ReactNode;
  onSettingsClick?: () => void;
}

export function PageHeader({ title, onSettingsClick }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="center">
      {typeof title === 'string' ? <Title order={2}>{title}</Title> : title}
      {onSettingsClick && (
        <ActionIcon
          variant="subtle"
          size="md"
          onClick={onSettingsClick}
          aria-label="Page settings"
        >
          <IconSettings size={18} />
        </ActionIcon>
      )}
    </Group>
  );
}
