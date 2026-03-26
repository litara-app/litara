import { useState, useEffect } from 'react';
import {
  Title,
  Stack,
  Paper,
  Text,
  Group,
  TextInput,
  Button,
  ActionIcon,
  Badge,
  Alert,
  Skeleton,
  SegmentedControl,
} from '@mantine/core';
import { useMantineColorScheme } from '@mantine/core';
import {
  IconTrash,
  IconStar,
  IconStarFilled,
  IconPlus,
  IconAlertTriangle,
} from '@tabler/icons-react';
import axios from 'axios';
import { useAtom } from 'jotai';
import { api } from '../utils/api';
import { userSettingsAtom } from '../store/atoms';
import type { UserSettings } from '../store/atoms';
import { SmtpConfigForm } from './SmtpConfigForm';

interface RecipientEmail {
  id: string;
  email: string;
  label: string | null;
  isDefault: boolean;
  createdAt: string;
}

export function RecipientEmailsSection() {
  const [emails, setEmails] = useState<RecipientEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [addEmail, setAddEmail] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    api
      .get<RecipientEmail[]>('/users/me/recipient-emails')
      .then((r) => setEmails(r.data))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd() {
    if (!addEmail.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await api.post<RecipientEmail>('/users/me/recipient-emails', {
        email: addEmail.trim(),
        label: addLabel.trim() || undefined,
      });
      setEmails((prev) => [...prev, res.data]);
      setAddEmail('');
      setAddLabel('');
    } catch (e) {
      const msg = axios.isAxiosError(e) && e.response?.data?.message;
      setAddError(typeof msg === 'string' ? msg : 'Failed to add email.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    await api.delete(`/users/me/recipient-emails/${id}`);
    setEmails((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleSetDefault(id: string) {
    const res = await api.patch<RecipientEmail>(
      `/users/me/recipient-emails/${id}/default`,
    );
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? res.data : { ...e, isDefault: false })),
    );
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Recipient Emails</Title>
        <Text size="sm" c="dimmed">
          Email addresses to send books to (e.g. your Kindle address). The
          default is used when you click Send without choosing a recipient.
        </Text>

        {loading ? (
          <Stack gap="xs">
            <Skeleton height={36} radius="sm" />
            <Skeleton height={36} radius="sm" />
          </Stack>
        ) : emails.length === 0 ? (
          <Text size="sm" c="dimmed">
            No recipient emails yet.
          </Text>
        ) : (
          <Stack gap={4}>
            {emails.map((e) => (
              <Group
                key={e.id}
                justify="space-between"
                py="xs"
                style={{
                  borderBottom: '1px solid var(--mantine-color-default-border)',
                }}
              >
                <Group gap="xs">
                  {e.isDefault ? (
                    <Badge size="xs" color="blue" variant="filled">
                      Default
                    </Badge>
                  ) : (
                    <Badge size="xs" color="gray" variant="outline">
                      &nbsp;
                    </Badge>
                  )}
                  <div>
                    <Text size="sm">{e.email}</Text>
                    {e.label && (
                      <Text size="xs" c="dimmed">
                        {e.label}
                      </Text>
                    )}
                  </div>
                </Group>
                <Group gap="xs">
                  {!e.isDefault && (
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      title="Set as default"
                      onClick={() => void handleSetDefault(e.id)}
                    >
                      <IconStar size={14} />
                    </ActionIcon>
                  )}
                  {e.isDefault && (
                    <ActionIcon size="sm" variant="subtle" disabled>
                      <IconStarFilled size={14} />
                    </ActionIcon>
                  )}
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => void handleDelete(e.id)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              </Group>
            ))}
          </Stack>
        )}

        <Group gap="xs" align="flex-end">
          <TextInput
            label="Email address"
            placeholder="name@kindle.com"
            value={addEmail}
            onChange={(e) => setAddEmail(e.currentTarget.value)}
            style={{ flex: 1 }}
            error={
              addEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addEmail)
                ? 'Enter a valid email'
                : undefined
            }
          />
          <TextInput
            label="Label (optional)"
            placeholder="My Kindle"
            value={addLabel}
            onChange={(e) => setAddLabel(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button
            leftSection={<IconPlus size={14} />}
            onClick={() => void handleAdd()}
            loading={adding}
            mb={
              addEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addEmail) ? 20 : 0
            }
          >
            Add
          </Button>
        </Group>

        {addError && (
          <Alert
            icon={<IconAlertTriangle size={14} />}
            color="red"
            variant="light"
          >
            {addError}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}

export function SettingsContent() {
  const [userSettings, setUserSettings] = useAtom(userSettingsAtom);
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  async function handleItemSizeChange(val: string) {
    const updated = {
      ...userSettings,
      bookItemSize: val as UserSettings['bookItemSize'],
    };
    setUserSettings(updated);
    await api.patch('/users/me/settings', { bookItemSize: val });
  }

  return (
    <Stack gap="lg">
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Display</Title>
          <Text size="sm" c="dimmed">
            Appearance
          </Text>
          <SegmentedControl
            value={colorScheme}
            onChange={(val) => setColorScheme(val as 'light' | 'dark' | 'auto')}
            data={[
              { label: 'Light', value: 'light' },
              { label: 'Auto', value: 'auto' },
              { label: 'Dark', value: 'dark' },
            ]}
            w="fit-content"
          />
          <Text size="sm" c="dimmed">
            Book item size
          </Text>
          <SegmentedControl
            value={userSettings.bookItemSize}
            onChange={(val) => void handleItemSizeChange(val)}
            data={[
              { label: 'S', value: 'sm' },
              { label: 'M', value: 'md' },
              { label: 'L', value: 'lg' },
              { label: 'XL', value: 'xl' },
            ]}
            w="fit-content"
          />
        </Stack>
      </Paper>

      <RecipientEmailsSection />

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Personal SMTP</Title>
          <Text size="sm" c="dimmed">
            Your personal outgoing mail server. When set, this is used instead
            of any server-level SMTP when you send books. Useful when you need
            to send from a specific address approved by your Kindle account.
          </Text>
          <SmtpConfigForm
            configPath="/users/me/smtp"
            testPath="/users/me/smtp/test"
          />
        </Stack>
      </Paper>
    </Stack>
  );
}
