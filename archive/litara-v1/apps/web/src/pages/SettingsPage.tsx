import { Title, Stack } from '@mantine/core';
import { SettingsContent } from '../components/SettingsContent';

export function SettingsPage() {
  return (
    <Stack gap="lg">
      <Title order={2}>Settings</Title>
      <SettingsContent />
    </Stack>
  );
}
