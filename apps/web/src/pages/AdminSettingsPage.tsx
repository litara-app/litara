import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Title,
  Stack,
  Paper,
  Text,
  Button,
  Badge,
  Checkbox,
  Alert,
  Group,
  TextInput,
  ActionIcon,
  Skeleton,
  Select,
  Modal,
  PasswordInput,
  Switch,
  CopyButton,
  Tooltip,
  Avatar,
  Table,
  Tabs,
  Progress,
} from '@mantine/core';
import {
  IconScan,
  IconAlertTriangle,
  IconAlertCircle,
  IconCheck,
  IconTrash,
  IconUserPlus,
  IconCopy,
  IconX,
} from '@tabler/icons-react';
import axios from 'axios';
import { api } from '../utils/api';
import { SmtpConfigForm } from '../components/SmtpConfigForm';
import { MetadataMatchingPage } from './admin/MetadataMatchingPage';

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  createdAt: string;
}

// ─── User Management ──────────────────────────────────────────────────────────

function UserManagementSection() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    email: '',
    name: '',
    password: '',
    role: 'USER' as 'USER' | 'ADMIN',
  });
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  const currentUserId: string = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') ?? '{}').id ?? '';
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    api
      .get<UserRecord[]>('/admin/users')
      .then((r) => setUsers(r.data))
      .finally(() => setLoading(false));
  }, []);

  async function handleRoleChange(userId: string, role: 'USER' | 'ADMIN') {
    const res = await api.patch<UserRecord>(`/admin/users/${userId}`, { role });
    setUsers((prev) => prev.map((u) => (u.id === userId ? res.data : u)));
  }

  async function handleDelete(userId: string) {
    await api.delete(`/admin/users/${userId}`);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
  }

  async function handleAdd() {
    if (!addForm.email || !addForm.password) {
      setAddError('Email and password are required.');
      return;
    }
    setAdding(true);
    setAddError('');
    try {
      const res = await api.post<UserRecord>('/admin/users', addForm);
      setUsers((prev) => [...prev, res.data]);
      setAddOpen(false);
      setAddForm({ email: '', name: '', password: '', role: 'USER' });
    } catch (e) {
      const message = axios.isAxiosError(e) && e.response?.data?.message;
      setAddError(
        typeof message === 'string' ? message : 'Failed to create user.',
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={4}>User Management</Title>
          <Button
            size="xs"
            leftSection={<IconUserPlus size={14} />}
            onClick={() => setAddOpen(true)}
          >
            Add User
          </Button>
        </Group>

        {loading ? (
          <Stack gap="xs">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} height={52} radius="sm" />
            ))}
          </Stack>
        ) : (
          <Stack gap={0}>
            {users.map((u) => (
              <Group
                key={u.id}
                justify="space-between"
                py="sm"
                style={{
                  borderBottom: '1px solid var(--mantine-color-default-border)',
                }}
              >
                <Group gap="sm">
                  <Avatar
                    radius="xl"
                    size="md"
                    name={u.name ?? u.email}
                    color="initials"
                  />
                  <div>
                    <Text size="sm" fw={500}>
                      {u.name ?? '—'}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {u.email}
                    </Text>
                  </div>
                </Group>
                <Group gap="xs">
                  <Select
                    value={u.role}
                    onChange={(v) =>
                      v && void handleRoleChange(u.id, v as 'USER' | 'ADMIN')
                    }
                    data={[
                      { value: 'USER', label: 'User' },
                      { value: 'ADMIN', label: 'Admin' },
                    ]}
                    size="xs"
                    w={100}
                    disabled={u.id === currentUserId}
                  />
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    disabled={u.id === currentUserId}
                    onClick={() => void handleDelete(u.id)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Paper>

      <Modal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add User"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label="Email"
            required
            value={addForm.email}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setAddForm((f) => ({ ...f, email: v }));
            }}
            error={
              addForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addForm.email)
                ? 'Enter a valid email address'
                : undefined
            }
          />
          <TextInput
            label="Name"
            value={addForm.name}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setAddForm((f) => ({ ...f, name: v }));
            }}
          />
          <PasswordInput
            label="Password"
            required
            value={addForm.password}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setAddForm((f) => ({ ...f, password: v }));
            }}
          />
          <Select
            label="Role"
            value={addForm.role}
            onChange={(v) =>
              v && setAddForm((f) => ({ ...f, role: v as 'USER' | 'ADMIN' }))
            }
            data={[
              { value: 'USER', label: 'User' },
              { value: 'ADMIN', label: 'Admin' },
            ]}
          />
          {addError && (
            <Alert color="red" icon={<IconAlertTriangle size={14} />}>
              {addError}
            </Alert>
          )}
          <Button onClick={() => void handleAdd()} loading={adding} mt="xs">
            Create User
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

// ─── OPDS ─────────────────────────────────────────────────────────────────────

interface OpdsSettings {
  enabled: boolean;
  v1Url: string;
  v2Url: string;
}

interface OpdsUserRecord {
  id: string;
  username: string;
  createdAt: string;
}

function UrlField({
  label,
  url,
  experimental,
}: {
  label: string;
  url: string;
  experimental?: boolean;
}) {
  return (
    <TextInput
      label={
        experimental ? (
          <Group gap={4} wrap="nowrap">
            <span>{label}</span>
            <Group gap={4} wrap="nowrap" c="red">
              <IconAlertCircle size={13} />
              <Text span size="xs" c="red">
                Experimental — please report issues
              </Text>
            </Group>
          </Group>
        ) : (
          label
        )
      }
      value={url}
      readOnly
      rightSection={
        <CopyButton value={url}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
              <ActionIcon
                variant="subtle"
                color={copied ? 'teal' : 'gray'}
                onClick={copy}
              >
                <IconCopy size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      }
    />
  );
}

function OpdsCatalogSection() {
  const [settings, setSettings] = useState<OpdsSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [opdsUsers, setOpdsUsers] = useState<OpdsUserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ username: '', password: '' });
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api
      .get<OpdsSettings>('/admin/settings/opds')
      .then((r) => setSettings(r.data))
      .catch(() => {});
    api
      .get<OpdsUserRecord[]>('/admin/opds-users')
      .then((r) => setOpdsUsers(r.data))
      .finally(() => setUsersLoading(false));
  }, []);

  async function handleToggle(enabled: boolean) {
    if (!settings) return;
    setSaving(true);
    try {
      await api.patch('/admin/settings/opds', { enabled });
      setSettings((s) => (s ? { ...s, enabled } : s));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddUser() {
    if (!addForm.username.trim() || !addForm.password) {
      setAddError('Username and password are required.');
      return;
    }
    setAdding(true);
    setAddError('');
    try {
      const res = await api.post<OpdsUserRecord>('/admin/opds-users', addForm);
      setOpdsUsers((prev) => [...prev, res.data]);
      setAddOpen(false);
      setAddForm({ username: '', password: '' });
    } catch (e) {
      const message = axios.isAxiosError(e) && e.response?.data?.message;
      setAddError(
        typeof message === 'string' ? message : 'Failed to create user.',
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteUser(id: string) {
    await api.delete(`/admin/opds-users/${id}`);
    setOpdsUsers((prev) => prev.filter((u) => u.id !== id));
  }

  if (!settings) return <Skeleton height={100} radius="md" />;

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>OPDS Catalog</Title>
            <Switch
              checked={settings.enabled}
              onChange={(e) => void handleToggle(e.currentTarget.checked)}
              disabled={saving}
              label={settings.enabled ? 'Enabled' : 'Disabled'}
            />
          </Group>
          <Text size="sm" c="dimmed">
            Expose an OPDS catalog so ebook reader apps (KOReader, Moon+ Reader,
            Thorium Reader) can browse and download books directly. Uses
            dedicated OPDS credentials — not your Litara account.
          </Text>

          {settings.enabled && (
            <Stack gap="xs">
              <UrlField
                label="OPDS v1.2 (Atom XML — KOReader, Moon+ Reader, Pocketbook)"
                url={settings.v1Url}
              />
              <UrlField
                label="OPDS v2.0 (JSON — Thorium Reader)"
                url={settings.v2Url}
                experimental
              />
            </Stack>
          )}

          <Group justify="space-between" mt="xs">
            <Text size="sm" fw={500}>
              OPDS Users
            </Text>
            <Button
              size="xs"
              leftSection={<IconUserPlus size={14} />}
              onClick={() => setAddOpen(true)}
            >
              Add User
            </Button>
          </Group>

          {usersLoading ? (
            <Stack gap="xs">
              <Skeleton height={36} radius="sm" />
            </Stack>
          ) : opdsUsers.length === 0 ? (
            <Text size="sm" c="dimmed">
              No OPDS users yet. Add one to enable access.
            </Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Username</Table.Th>
                  <Table.Th style={{ width: 40 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {opdsUsers.map((u) => (
                  <Table.Tr key={u.id}>
                    <Table.Td>
                      <Text size="sm">{u.username}</Text>
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        onClick={() => void handleDeleteUser(u.id)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Paper>

      <Modal
        opened={addOpen}
        onClose={() => {
          setAddOpen(false);
          setAddForm({ username: '', password: '' });
          setAddError('');
        }}
        title="Add OPDS User"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label="Username"
            required
            value={addForm.username}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setAddForm((f) => ({ ...f, username: v }));
            }}
          />
          <PasswordInput
            label="Password"
            required
            value={addForm.password}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setAddForm((f) => ({ ...f, password: v }));
            }}
          />
          {addError && (
            <Alert color="red" icon={<IconAlertTriangle size={14} />}>
              {addError}
            </Alert>
          )}
          <Button onClick={() => void handleAddUser()} loading={adding} mt="xs">
            Create User
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

// ─── Metadata Sources ─────────────────────────────────────────────────────────

// ─── Library Scan ─────────────────────────────────────────────────────────────

function LibraryScanSection() {
  const [rescanMetadata, setRescanMetadata] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  async function handleForceScan() {
    setScanning(true);
    setResult(null);
    try {
      const qs = rescanMetadata ? '?rescanMetadata=true' : '';
      await api.post(`/library/scan${qs}`);
      setResult('success');
    } catch {
      setResult('error');
    } finally {
      setScanning(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Library Scan</Title>
        <Text size="sm" c="dimmed">
          Trigger a full re-scan of all watched folders. New files will be
          imported, and any previously missing files that have returned will be
          restored.
        </Text>

        <Checkbox
          label="Re-scan metadata from file (re-reads title, authors, and cover from each file)"
          checked={rescanMetadata}
          onChange={(e) => setRescanMetadata(e.currentTarget.checked)}
        />

        {result === 'success' && (
          <Alert icon={<IconCheck size={16} />} color="green" variant="light">
            Scan started. The library will update in the background.
          </Alert>
        )}
        {result === 'error' && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="red"
            variant="light"
          >
            Failed to start scan. Check server logs for details.
          </Alert>
        )}

        <Button
          leftSection={<IconScan size={16} />}
          onClick={() => void handleForceScan()}
          loading={scanning}
          w="fit-content"
        >
          Force Full Scan
        </Button>
      </Stack>
    </Paper>
  );
}

// ─── Main AdminSettingsPage ───────────────────────────────────────────────────

// ── Tasks Tab ─────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

interface TaskRecord {
  id: string;
  status: TaskStatus;
  payload: {
    processed?: number;
    total?: number;
    currentBookTitle?: string;
  } | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING: 'yellow',
  PROCESSING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  CANCELLED: 'gray',
};

function TasksTab() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tasksJsonRef = useRef<string>('');

  const fetchTasks = useCallback(async (): Promise<boolean> => {
    const res = await api.get<TaskRecord[]>('/admin/metadata-match/tasks');
    const json = JSON.stringify(res.data);
    if (json !== tasksJsonRef.current) {
      tasksJsonRef.current = json;
      setTasks(res.data);
    }
    setLoading(false);

    const hasActive = res.data.some(
      (t) => t.status === 'PENDING' || t.status === 'PROCESSING',
    );
    if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return hasActive;
  }, []);

  useEffect(() => {
    // fetchTasks calls setState inside a resolved promise — not synchronous in the effect body
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchTasks().then((hasActive) => {
      if (hasActive) {
        pollRef.current = setInterval(() => void fetchTasks(), 2000);
      }
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchTasks]);

  async function handleCancel(taskId: string) {
    await api.post(`/admin/metadata-match/cancel/${taskId}`);
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'CANCELLED' } : t)),
    );
  }

  if (loading) {
    return (
      <Stack gap="xs">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={72} radius="sm" />
        ))}
      </Stack>
    );
  }

  if (tasks.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No enrichment runs yet. Start one from the Metadata Matching tab.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {tasks.map((task) => {
        const p = task.payload;
        const total = p?.total ?? 0;
        const processed = p?.processed ?? 0;
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        const isActive =
          task.status === 'PENDING' || task.status === 'PROCESSING';

        return (
          <Paper key={task.id} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs">
                  <Badge
                    size="sm"
                    color={STATUS_COLORS[task.status]}
                    variant={isActive ? 'filled' : 'light'}
                  >
                    {task.status}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {new Date(task.createdAt).toLocaleString()}
                  </Text>
                </Group>

                {isActive && (
                  <>
                    <Progress value={pct} animated size="sm" />
                    <Text size="xs" c="dimmed">
                      {p?.currentBookTitle
                        ? `Processing: ${p.currentBookTitle}`
                        : 'Starting...'}
                      {'  '}
                      <Text span fw={500}>
                        {processed} / {total}
                      </Text>
                    </Text>
                  </>
                )}

                {task.status === 'COMPLETED' && (
                  <Text size="xs" c="dimmed">
                    Enriched {total} books
                  </Text>
                )}

                {task.status === 'FAILED' && task.errorMessage && (
                  <Text size="xs" c="red">
                    {task.errorMessage}
                  </Text>
                )}

                {task.status === 'CANCELLED' && (
                  <Text size="xs" c="dimmed">
                    Cancelled after {processed} / {total} books
                  </Text>
                )}
              </Stack>

              {isActive && (
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={() => void handleCancel(task.id)}
                >
                  <IconX size={14} />
                </ActionIcon>
              )}
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}

// ── Main AdminSettingsPage ────────────────────────────────────────────────────

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
        </Tabs.List>

        <Tabs.Panel value="general">
          <Stack gap="lg">
            <UserManagementSection />
            <OpdsCatalogSection />
            <Paper withBorder p="md" radius="md">
              <Stack gap="sm">
                <Title order={4}>Email / SMTP</Title>
                <Text size="sm" c="dimmed">
                  Server-level outgoing mail configuration. Used as a fallback
                  for users who have not set up their own SMTP in Settings.
                </Text>
                <SmtpConfigForm
                  configPath="/settings/smtp"
                  testPath="/settings/smtp/test"
                />
              </Stack>
            </Paper>
            <LibraryScanSection />
          </Stack>
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
      </Tabs>
    </Stack>
  );
}
