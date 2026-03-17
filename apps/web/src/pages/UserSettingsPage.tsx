import { Title, Stack, Paper, Text, Group, Avatar } from '@mantine/core';
import { IconUser } from '@tabler/icons-react';

export function UserSettingsPage() {
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') ?? '{}');
    } catch {
      return {};
    }
  })();

  const displayName = user?.name ?? user?.email ?? 'Unknown';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Stack gap="lg">
      <Title order={2}>Account</Title>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Profile</Title>
          <Group gap="md">
            <Avatar size="lg" radius="xl" color="blue">
              {initials || <IconUser size={24} />}
            </Avatar>
            <Stack gap={2}>
              {user?.name && <Text fw={500}>{user.name}</Text>}
              <Text size="sm" c="dimmed">
                {user?.email ?? '—'}
              </Text>
              <Text size="xs" c="dimmed" tt="capitalize">
                {user?.role?.toLowerCase() ?? '—'}
              </Text>
            </Stack>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}
