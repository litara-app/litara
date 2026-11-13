import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stack, Title, Paper } from '@mantine/core';
import { api } from '../utils/api';
import { useSetAtom } from 'jotai';
import { librariesAtom, activeScanTasksAtom } from '../store/atoms';
import type { Library } from '../store/atoms';
import { LibraryForm } from '../components/LibraryForm';
import type { LibraryFormValues } from '../components/LibraryForm';
import { pushToast } from '../utils/toast';

export function LibraryCreatePage() {
  const navigate = useNavigate();
  const setLibraries = useSetAtom(librariesAtom);
  const setActiveScanTasks = useSetAtom(activeScanTasksAtom);
  const [loading, setLoading] = useState(false);
  const [libraryRoot, setLibraryRoot] = useState('/books');

  useEffect(() => {
    api
      .get<{ libraryRoot: string }>('/setup/disk-status')
      .then((res) => setLibraryRoot(res.data.libraryRoot))
      .catch(() => {});
  }, []);

  async function handleSubmit(values: LibraryFormValues) {
    setLoading(true);
    try {
      const res = await api.post<Library>('/libraries', {
        name: values.name,
        path: values.path,
        iconKey: values.iconKey || null,
        metadataProvidersDisabled: values.metadataProvidersDisabled,
      });
      const library = res.data;
      setLibraries((prev) => [...prev, library]);

      // Kick off initial scan
      try {
        const scanRes = await api.post<{ taskId: string }>(
          `/libraries/${library.id}/scan`,
        );
        setActiveScanTasks((prev) => ({
          ...prev,
          [library.id]: scanRes.data.taskId,
        }));
      } catch {
        // Scan failed to kick off — not fatal
      }

      pushToast(`Library "${library.name}" created`, { color: 'green' });
      navigate(`/library/${library.id}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to create library';
      pushToast(msg, { color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack maw={500} mx="auto" mt="xl" gap="lg">
      <Title order={2}>New Library</Title>
      <Paper withBorder p="lg" radius="md">
        <LibraryForm
          mode="create"
          libraryRoot={libraryRoot}
          onSubmit={handleSubmit}
          loading={loading}
        />
      </Paper>
    </Stack>
  );
}
