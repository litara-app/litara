import { useState } from 'react';
import { Title, Stack, Tabs, Text } from '@mantine/core';
import { GeneralTab } from './admin/GeneralTab';
import { MetadataMatchingPage } from './admin/MetadataMatchingPage';
import { TasksTab } from './admin/TasksTab';
import { AboutTab } from './admin/AboutTab';

export function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<string | null>('general');

  return (
    <Stack gap="lg">
      <Title order={2}>Admin Settings</Title>

      <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="metadata-matching">Metadata</Tabs.Tab>
          <Tabs.Tab value="tasks">Tasks</Tabs.Tab>
          <Tabs.Tab value="about">About</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general">
          <GeneralTab onTaskStarted={() => setActiveTab('tasks')} />
        </Tabs.Panel>

        <Tabs.Panel value="metadata-matching">
          <MetadataMatchingPage onRunStarted={() => setActiveTab('tasks')} />
        </Tabs.Panel>

        <Tabs.Panel value="tasks">
          <Stack gap="md">
            <Stack gap={4}>
              <Text fw={500}>Enrichment Runs</Text>
              <Text size="sm" c="dimmed">
                Live status of all metadata enrichment runs. Active runs update
                every 2 seconds.
              </Text>
            </Stack>
            <TasksTab />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="about">
          <AboutTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
