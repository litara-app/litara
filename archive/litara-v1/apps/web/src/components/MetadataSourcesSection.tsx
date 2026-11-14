import { useState, useEffect } from 'react';
import {
  Paper,
  Stack,
  Title,
  Text,
  Badge,
  Button,
  Switch,
  Group,
  Skeleton,
} from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { api } from '../utils/api';

export interface MetadataProviderStatus {
  id: string;
  label: string;
  enabled: boolean;
  requiresApiKey: boolean;
  apiKeyConfigured: boolean;
  available: boolean;
}

const PROVIDER_COLORS: Record<string, string> = {
  hardcover: 'orange',
  'open-library': 'teal',
  'google-books': 'blue',
  goodreads: 'green',
};

interface MetadataSourcesSectionProps {
  onProvidersChange?: (providers: MetadataProviderStatus[]) => void;
}

export function MetadataSourcesSection({
  onProvidersChange,
}: MetadataSourcesSectionProps = {}) {
  const [providers, setProviders] = useState<MetadataProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string } | 'loading'>
  >({});

  useEffect(() => {
    api
      .get<MetadataProviderStatus[]>('/admin/settings/metadata-providers')
      .then((r) => {
        setProviders(r.data);
        onProvidersChange?.(r.data);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggle(id: string, enabled: boolean) {
    const res = await api.patch<MetadataProviderStatus[]>(
      `/admin/settings/metadata-providers/${id}`,
      { enabled },
    );
    setProviders(res.data);
    onProvidersChange?.(res.data);
  }

  async function handleTest(id: string) {
    setTestResults((prev) => ({ ...prev, [id]: 'loading' }));
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/admin/settings/metadata-providers/${id}/test`,
      );
      setTestResults((prev) => ({ ...prev, [id]: res.data }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: 'Request failed' },
      }));
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Metadata Sources</Title>
        <Text size="sm" c="dimmed">
          Control which metadata providers are available. Providers with
          required API keys must be configured in your environment variables.
          Disabling a source will automatically reassign any field mappings that
          use it.
        </Text>

        {loading ? (
          <Stack gap="xs">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={52} radius="sm" />
            ))}
          </Stack>
        ) : (
          <Stack gap={0}>
            {providers.map((p) => {
              const color = PROVIDER_COLORS[p.id] ?? 'gray';
              const testResult = testResults[p.id];
              return (
                <Group
                  key={p.id}
                  justify="space-between"
                  py="sm"
                  style={{
                    borderBottom:
                      '1px solid var(--mantine-color-default-border)',
                  }}
                >
                  <Group gap="sm">
                    <Badge color={color} variant="light" size="sm" miw={100}>
                      {p.label}
                    </Badge>
                    <Stack gap={2}>
                      {p.requiresApiKey && (
                        <Badge
                          size="xs"
                          variant="outline"
                          color={p.apiKeyConfigured ? 'green' : 'yellow'}
                        >
                          {p.apiKeyConfigured ? 'API Key Set' : 'No API Key'}
                        </Badge>
                      )}
                      {testResult && testResult !== 'loading' && (
                        <Text size="xs" c={testResult.ok ? 'green' : 'red'}>
                          {testResult.ok ? '✓' : '✗'} {testResult.message}
                        </Text>
                      )}
                    </Stack>
                  </Group>
                  <Group gap="xs">
                    {p.requiresApiKey && (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconPlugConnected size={12} />}
                        loading={testResult === 'loading'}
                        disabled={!p.apiKeyConfigured}
                        onClick={() => void handleTest(p.id)}
                      >
                        Test
                      </Button>
                    )}
                    <Switch
                      checked={p.enabled}
                      disabled={!p.available}
                      onChange={(e) =>
                        void handleToggle(p.id, e.currentTarget.checked)
                      }
                      label={p.enabled ? 'Enabled' : 'Disabled'}
                    />
                  </Group>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
