import { Title, Stack, Paper, Text, Group, Avatar, Tabs } from '@mantine/core';
import { IconUser, IconChartBar, IconBook } from '@tabler/icons-react';
import { LibraryStatsTab } from '../components/LibraryStatsTab';
import { ReadingStatsTab } from '../components/ReadingStatsTab';

export function ProfilePage() {
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
      <Title order={2}>Profile</Title>

      <Paper withBorder p="md" radius="md">
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
      </Paper>

      <Tabs defaultValue="library-stats">
        <Tabs.List>
          <Tabs.Tab
            value="library-stats"
            leftSection={<IconChartBar size={16} />}
          >
            Library Statistics
          </Tabs.Tab>
          <Tabs.Tab value="reading-stats" leftSection={<IconBook size={16} />}>
            Reading Stats
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="library-stats" pt="lg">
          <LibraryStatsTab />
        </Tabs.Panel>

        <Tabs.Panel value="reading-stats" pt="lg">
          <ReadingStatsTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
