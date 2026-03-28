import { useState, useEffect, useCallback } from 'react';
import {
  Title,
  Stack,
  Paper,
  Text,
  Button,
  Alert,
  Group,
  Badge,
  Anchor,
  Code,
  Loader,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCheck,
  IconRefresh,
  IconArrowUpCircle,
} from '@tabler/icons-react';
import { useAtom, useSetAtom } from 'jotai';
import { api } from '../../utils/api';
import { updateAvailableAtom, versionCheckResultAtom } from '../../store/atoms';
import type { VersionCheckResult } from '../../types/server';

export function AboutTab() {
  const [result, setResult] = useAtom(versionCheckResultAtom);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUpdateAvailable = useSetAtom(updateAvailableAtom);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<VersionCheckResult>('/server/version-check');
      setResult(res.data);
      setUpdateAvailable(res.data.updateAvailable);
    } catch {
      setError(
        'Failed to check for updates. The server may not be able to reach GitHub.',
      );
    } finally {
      setLoading(false);
    }
  }, [setResult, setUpdateAvailable]);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <Stack gap="lg">
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Title order={4}>Version</Title>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconRefresh size={14} />}
              onClick={() => void check()}
              loading={loading}
            >
              Refresh
            </Button>
          </Group>

          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Current version:
            </Text>
            <Badge variant="light" color="blue">
              {__APP_VERSION__}
            </Badge>
          </Group>

          {loading && !result && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                Checking for updates...
              </Text>
            </Group>
          )}

          {error && (
            <Alert
              icon={<IconAlertTriangle size={14} />}
              color="orange"
              variant="light"
            >
              {error}
            </Alert>
          )}

          {result &&
            !loading &&
            (result.updateAvailable ? (
              <Alert
                icon={<IconArrowUpCircle size={16} />}
                color="green"
                variant="light"
                title="Update available"
              >
                <Stack gap="xs">
                  <Text size="sm">
                    Version <strong>{result.latestVersion}</strong> is
                    available.{' '}
                    <Anchor href={result.releaseUrl} target="_blank" size="sm">
                      View release on GitHub
                    </Anchor>
                  </Text>
                  <Text size="xs" c="dimmed">
                    Cached at {new Date(result.cachedAt).toLocaleString()}
                  </Text>
                </Stack>
              </Alert>
            ) : (
              <Alert
                icon={<IconCheck size={16} />}
                color="teal"
                variant="light"
                title="Up to date"
              >
                <Stack gap="xs">
                  <Text size="sm">
                    You are running the latest version ({result.latestVersion}).{' '}
                    <Anchor href={result.releaseUrl} target="_blank" size="sm">
                      View releases
                    </Anchor>
                  </Text>
                  <Text size="xs" c="dimmed">
                    Cached at {new Date(result.cachedAt).toLocaleString()}
                  </Text>
                </Stack>
              </Alert>
            ))}
        </Stack>
      </Paper>

      {result?.updateAvailable && result.releaseNotes && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Release Notes — v{result.latestVersion}</Title>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
                maxHeight: 400,
                overflowY: 'auto',
              }}
            >
              {result.releaseNotes}
            </Code>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
