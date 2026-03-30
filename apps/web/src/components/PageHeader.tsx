import { Group, Title, ActionIcon } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';

interface PageHeaderProps {
  title: React.ReactNode;
  onSettingsClick?: () => void;
  rightActions?: React.ReactNode;
}

export function PageHeader({
  title,
  onSettingsClick,
  rightActions,
}: PageHeaderProps) {
  return (
    <Group justify="space-between" align="center">
      {typeof title === 'string' ? <Title order={2}>{title}</Title> : title}
      <Group gap="xs">
        {rightActions}
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
    </Group>
  );
}
