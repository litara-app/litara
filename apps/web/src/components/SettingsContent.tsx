import { useState, useEffect } from 'react';
import {
  Title,
  Stack,
  Paper,
  Text,
  Group,
  TextInput,
  PasswordInput,
  Button,
  ActionIcon,
  Badge,
  Alert,
  Skeleton,
  SegmentedControl,
  CopyButton,
  Code,
} from '@mantine/core';
import { useMantineColorScheme } from '@mantine/core';
import {
  IconTrash,
  IconStar,
  IconStarFilled,
  IconPlus,
  IconAlertTriangle,
  IconCopy,
  IconCheck,
} from '@tabler/icons-react';
import axios from 'axios';
import { useAtom } from 'jotai';
import { api } from '../utils/api';
import { userSettingsAtom } from '../store/atoms';
import type { UserSettings, ProgressDisplaySource } from '../store/atoms';
import { SmtpConfigForm } from './SmtpConfigForm';
import { ChangePasswordSection } from './ChangePasswordSection';

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

interface KoReaderCredential {
  username: string;
  createdAt: string;
}

export function KoReaderSyncSection() {
  const [userSettings, setUserSettings] = useAtom(userSettingsAtom);
  const [credential, setCredential] = useState<KoReaderCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncUrl, setSyncUrl] = useState('');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const host = window.location.origin;
    setSyncUrl(`${host}/1`);
    api
      .get<{ credential: KoReaderCredential | null }>(
        '/users/me/koreader-credentials',
      )
      .then((r) => setCredential(r.data.credential))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      // MD5-hash the password client-side as KOReader expects
      const { default: SparkMD5 } = await import('spark-md5');
      const passwordHash = SparkMD5.hash(password);
      const res = await api.post<{ credential: KoReaderCredential }>(
        '/users/me/koreader-credentials',
        { username, password: passwordHash },
      );
      setCredential(res.data.credential);
      setUsername('');
      setPassword('');
    } catch (err) {
      const msg = axios.isAxiosError(err) && err.response?.data?.message;
      setCreateError(
        typeof msg === 'string' ? msg : 'Failed to create credentials.',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await api.delete('/users/me/koreader-credentials');
      setCredential(null);
    } finally {
      setRemoving(false);
    }
  }

  async function handleDisplaySourceChange(val: string) {
    const updated = {
      ...userSettings,
      progressDisplaySource: val as ProgressDisplaySource,
    };
    setUserSettings(updated);
    await api.patch('/users/me/settings', { progressDisplaySource: val });
  }

  if (loading) {
    return (
      <Paper withBorder p="md" radius="md">
        <Skeleton height={80} />
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>KOReader Sync</Title>
        <Text size="sm" c="dimmed">
          Use Litara as your KOReader sync server to keep reading position in
          sync across devices.
        </Text>

        {credential ? (
          <>
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                Sync server URL
              </Text>
              <Group gap="xs">
                <Code>{syncUrl}</Code>
                <CopyButton value={syncUrl} timeout={2000}>
                  {({ copied, copy }) => (
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color={copied ? 'teal' : 'gray'}
                      onClick={copy}
                    >
                      {copied ? (
                        <IconCheck size={14} />
                      ) : (
                        <IconCopy size={14} />
                      )}
                    </ActionIcon>
                  )}
                </CopyButton>
              </Group>
              <Text size="sm">
                KOReader username:{' '}
                <Text component="span" fw={500}>
                  {credential.username}
                </Text>
              </Text>
              <Text size="xs" c="dimmed">
                In KOReader with a document open, go to{' '}
                <strong>Tools → Progress Sync → Login</strong> and enter the URL
                above with your username and password.
              </Text>
            </Stack>
            <Button
              variant="light"
              color="red"
              size="xs"
              leftSection={<IconTrash size={14} />}
              loading={removing}
              onClick={() => void handleRemove()}
              w="fit-content"
            >
              Remove credentials
            </Button>
          </>
        ) : (
          <form onSubmit={(e) => void handleCreate(e)}>
            <Stack gap="sm">
              <Text size="sm">
                Create a username and password for KOReader to use.
              </Text>
              <TextInput
                label="KOReader username"
                placeholder="e.g. mykobo"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                required
              />
              <PasswordInput
                label="Password"
                placeholder="Choose a password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
              {createError && (
                <Alert color="red" icon={<IconAlertTriangle size={14} />}>
                  {createError}
                </Alert>
              )}
              <Button
                type="submit"
                loading={creating}
                disabled={!username.trim() || !password}
                w="fit-content"
              >
                Save credentials
              </Button>
            </Stack>
          </form>
        )}

        <Text size="sm" c="dimmed" mt="xs">
          Progress display preference
        </Text>
        <Text size="xs" c="dimmed">
          When a book has progress from both Litara and KOReader, show:
        </Text>
        <SegmentedControl
          value={userSettings.progressDisplaySource}
          onChange={(val) => void handleDisplaySourceChange(val)}
          data={[
            { label: 'Highest', value: 'HIGHEST' },
            { label: 'Most Recent', value: 'MOST_RECENT' },
            { label: 'KOReader', value: 'KOREADER' },
            { label: 'Litara', value: 'LITARA' },
          ]}
          w="fit-content"
        />
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

      <ChangePasswordSection />

      <KoReaderSyncSection />

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
