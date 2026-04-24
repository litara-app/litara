import { useState, useEffect } from 'react';
import {
  Title,
  Stack,
  Paper,
  Text,
  Button,
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
  Badge,
} from '@mantine/core';
import {
  IconScan,
  IconAlertTriangle,
  IconAlertCircle,
  IconCheck,
  IconTrash,
  IconUserPlus,
  IconCopy,
  IconLock,
  IconUsers,
  IconCode,
  IconFolderSearch,
  IconDownload,
} from '@tabler/icons-react';
import axios from 'axios';
import { api } from '../../utils/api';
import { SmtpConfigForm } from '../../components/SmtpConfigForm';

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  createdAt: string;
}

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
              leftSection={addOpen ? undefined : <IconUserPlus size={14} />}
              variant={addOpen ? 'subtle' : 'filled'}
              onClick={() => {
                setAddOpen((o) => !o);
                setAddForm({ username: '', password: '' });
                setAddError('');
              }}
            >
              {addOpen ? 'Cancel' : 'Add User'}
            </Button>
          </Group>

          {usersLoading ? (
            <Stack gap="xs">
              <Skeleton height={36} radius="sm" />
            </Stack>
          ) : opdsUsers.length === 0 && !addOpen ? (
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

          {addOpen && (
            <Stack
              gap="sm"
              pt="xs"
              style={{
                borderTop: '1px solid var(--mantine-color-default-border)',
              }}
            >
              <TextInput
                label="Username"
                placeholder="e.g. myreader"
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
              <Button
                size="xs"
                onClick={() => void handleAddUser()}
                loading={adding}
                disabled={!addForm.username.trim() || !addForm.password}
                w="fit-content"
              >
                Create User
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>
    </>
  );
}

interface KoReaderSettings {
  enabled: boolean;
  syncUrl: string;
}

function KoReaderSyncSection() {
  const [settings, setSettings] = useState<KoReaderSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{
    total: number;
    done: number;
    failed: number;
  } | null>(null);

  useEffect(() => {
    api
      .get<KoReaderSettings>('/admin/settings/koreader')
      .then((r) => setSettings(r.data))
      .catch(() => {});
  }, []);

  async function handleToggle(enabled: boolean) {
    if (!settings) return;
    setSaving(true);
    try {
      await api.patch('/admin/settings/koreader', { enabled });
      setSettings((s) => (s ? { ...s, enabled } : s));
    } finally {
      setSaving(false);
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await api.post<{
        total: number;
        done: number;
        failed: number;
      }>('/library/backfill-koreader-hashes');
      setBackfillResult(res.data);
    } catch {
      setBackfillResult({ total: -1, done: 0, failed: -1 });
    } finally {
      setBackfilling(false);
    }
  }

  if (!settings) return <Skeleton height={100} radius="md" />;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={4}>KOReader Sync</Title>
          <Switch
            checked={settings.enabled}
            onChange={(e) => void handleToggle(e.currentTarget.checked)}
            disabled={saving}
            label={settings.enabled ? 'Enabled' : 'Disabled'}
          />
        </Group>
        <Text size="sm" c="dimmed">
          Allows KOReader devices to sync reading position to Litara. Users
          create their own KOReader credentials in their profile settings.
        </Text>

        {settings.enabled && (
          <UrlField label="KOReader sync server URL" url={settings.syncUrl} />
        )}

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            MD5 hash backfill
          </Text>
          <Text size="sm" c="dimmed">
            KOReader identifies books by their MD5 hash. Run this after
            importing new files or if KOReader sync says it cannot find a book.
          </Text>
          {backfillResult && (
            <Alert
              color={
                backfillResult.total === -1
                  ? 'red'
                  : backfillResult.failed > 0
                    ? 'yellow'
                    : 'green'
              }
              icon={
                backfillResult.total === -1 ? (
                  <IconAlertTriangle size={14} />
                ) : (
                  <IconCheck size={14} />
                )
              }
            >
              {backfillResult.total === -1
                ? 'Backfill failed. Check server logs.'
                : backfillResult.total === 0
                  ? 'All files already have MD5 hashes.'
                  : `Done: ${backfillResult.done}/${backfillResult.total} hashed${backfillResult.failed > 0 ? `, ${backfillResult.failed} failed (check logs)` : ''}.`}
            </Alert>
          )}
          <Button
            variant="light"
            size="xs"
            loading={backfilling}
            onClick={() => void handleBackfill()}
            w="fit-content"
          >
            Run MD5 backfill
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function AuthorPhotoEnrichmentSection() {
  const [enriching, setEnriching] = useState(false);
  const [result, setResult] = useState<{
    taskId: string;
    total: number;
  } | null>(null);
  const [error, setError] = useState(false);

  async function handleEnrichAll() {
    setEnriching(true);
    setResult(null);
    setError(false);
    try {
      const res = await api.post<{ taskId: string; total: number }>(
        '/authors/enrich',
      );
      setResult(res.data);
    } catch {
      setError(true);
    } finally {
      setEnriching(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Author Data Enrichment</Title>
        <Text size="sm" c="dimmed">
          Fetch author photos and biographies from Open Library for all authors
          that are missing either. Runs as a background task — progress is
          visible in the Tasks tab.
        </Text>

        {result && (
          <Alert icon={<IconCheck size={16} />} color="green" variant="light">
            Enrichment queued for {result.total} author
            {result.total !== 1 ? 's' : ''} (task ID: {result.taskId})
          </Alert>
        )}
        {error && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="red"
            variant="light"
          >
            Failed to start enrichment. Check server logs for details.
          </Alert>
        )}

        <Button
          leftSection={<IconUsers size={16} />}
          onClick={() => void handleEnrichAll()}
          loading={enriching}
          w="fit-content"
        >
          Enrich All Author Data
        </Button>
      </Stack>
    </Paper>
  );
}

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

interface DiskSettings {
  allowDiskWrites: boolean;
  isReadOnlyMount: boolean;
}

function DiskSettingsSection() {
  const [settings, setSettings] = useState<DiskSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<DiskSettings>('/admin/settings/disk')
      .then((r) => setSettings(r.data))
      .catch(() => {});
  }, []);

  async function handleToggle(enabled: boolean) {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await api.patch<DiskSettings>('/admin/settings/disk', {
        allowDiskWrites: enabled,
      });
      setSettings(res.data);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <Skeleton height={100} radius="md" />;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={4}>Disk Writes</Title>
          <Switch
            checked={settings.allowDiskWrites}
            onChange={(e) => void handleToggle(e.currentTarget.checked)}
            disabled={saving}
            label={settings.allowDiskWrites ? 'Enabled' : 'Disabled'}
          />
        </Group>

        <Text size="sm" c="dimmed">
          When enabled, Litara can write metadata sidecar files (
          <code>.metadata.json</code>) alongside your ebook files. Ebook files
          themselves are never modified. For a hard guarantee, mount your
          library volume read-only in Docker (<code>:ro</code>).
        </Text>

        {settings.isReadOnlyMount && (
          <Alert
            icon={<IconLock size={16} />}
            color="yellow"
            variant="light"
            title="Library directory is read-only"
          >
            The library directory appears to be mounted read-only. Disk write
            operations will fail even if enabled above. Remove the{' '}
            <code>:ro</code> flag from your Docker volume mount if you want to
            allow writes.
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}

function ShelfmarkSettingsSection() {
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ shelfmarkUrl: string | null }>('/admin/settings/shelfmark')
      .then((r) => setSavedUrl(r.data.shelfmarkUrl))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch('/admin/settings/shelfmark', {
        shelfmarkUrl: editUrl.trim() || null,
      });
      setSavedUrl(editUrl.trim() || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await api.patch('/admin/settings/shelfmark', { shelfmarkUrl: null });
      setSavedUrl(null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Shelfmark</Title>
        <Text size="sm" c="dimmed">
          Optionally link to your self-hosted Shelfmark instance. When set, a
          link will appear in the top bar for all users.
        </Text>
        {loading ? (
          <Skeleton height={36} />
        ) : editing ? (
          <Group gap="sm">
            <TextInput
              placeholder="https://shelfmark.example.com"
              value={editUrl}
              onChange={(e) => setEditUrl(e.currentTarget.value)}
              style={{ flex: 1 }}
              autoFocus
            />
            <Button onClick={() => void handleSave()} loading={saving}>
              Save
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setEditing(false);
                setEditUrl(savedUrl ?? '');
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </Group>
        ) : savedUrl ? (
          <Group gap="sm">
            <TextInput value={savedUrl} readOnly style={{ flex: 1 }} />
            <Button
              variant="default"
              onClick={() => {
                setEditUrl(savedUrl);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <ActionIcon
              variant="subtle"
              color="red"
              size="lg"
              onClick={() => void handleRemove()}
              loading={saving}
              title="Remove Shelfmark URL"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ) : (
          <Group gap="sm">
            <Text size="sm" c="dimmed" style={{ flex: 1 }}>
              No Shelfmark URL configured.
            </Text>
            <Button
              variant="default"
              onClick={() => {
                setEditUrl('');
                setEditing(true);
              }}
            >
              Add URL
            </Button>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

function DevToolsSection() {
  const isPreviewMode = localStorage.getItem('devOriginalRole') !== null;

  function toggle(enable: boolean) {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return;
      const user = JSON.parse(raw) as { role: string };
      if (enable) {
        localStorage.setItem('devOriginalRole', user.role);
        user.role = 'USER';
      } else {
        const original = localStorage.getItem('devOriginalRole') ?? 'ADMIN';
        localStorage.removeItem('devOriginalRole');
        user.role = original;
      }
      localStorage.setItem('user', JSON.stringify(user));
      window.location.reload();
    } catch {
      // ignore
    }
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{ borderColor: 'var(--mantine-color-orange-6)' }}
    >
      <Stack gap="sm">
        <Group gap="sm">
          <IconCode size={18} color="var(--mantine-color-orange-5)" />
          <Title order={4}>Dev Tools</Title>
          <Badge color="orange" variant="light" size="sm">
            Dev only
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          Tools for testing non-admin functionality. Resets automatically on
          login or logout.
        </Text>
        <Switch
          label="Preview as non-admin user"
          description="Temporarily sets your role to USER so you can test non-admin views"
          checked={isPreviewMode}
          onChange={(e) => toggle(e.currentTarget.checked)}
          color="orange"
        />
      </Stack>
    </Paper>
  );
}

const TWO_GIB = 2 * 1024 * 1024 * 1024;

function LibraryManagementSection({
  onTaskStarted,
}: {
  onTaskStarted?: () => void;
}) {
  const [diskSettings, setDiskSettings] = useState<DiskSettings | null>(null);
  const [reorganizeConfirmOpen, setReorganizeConfirmOpen] = useState(false);
  const [reorganizing, setReorganizing] = useState(false);
  const [reorganizeResult, setReorganizeResult] = useState<
    'success' | 'error' | null
  >(null);

  const [backupWarningOpen, setBackupWarningOpen] = useState(false);
  const [backupSize, setBackupSize] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [includeAudiobooks, setIncludeAudiobooks] = useState(false);

  useEffect(() => {
    api
      .get<DiskSettings>('/admin/settings/disk')
      .then((r) => setDiskSettings(r.data))
      .catch(() => {});
  }, []);

  async function handleReorganizeClick() {
    setReorganizeResult(null);
    setReorganizeConfirmOpen(true);
  }

  async function handleReorganizeConfirm() {
    setReorganizeConfirmOpen(false);
    setReorganizing(true);
    try {
      await api.post('/admin/library/reorganize');
      setReorganizeResult('success');
      onTaskStarted?.();
    } catch {
      setReorganizeResult('error');
    } finally {
      setReorganizing(false);
    }
  }

  async function handleBackupClick() {
    setDownloading(true);
    try {
      const res = await api.get<{ totalBytes: number; fileCount: number }>(
        '/admin/library/backup/size',
        { params: includeAudiobooks ? { includeAudiobooks: 'true' } : {} },
      );
      setBackupSize(res.data.totalBytes);
      if (res.data.totalBytes >= TWO_GIB) {
        setBackupWarningOpen(true);
        setDownloading(false);
        return;
      }
    } catch {
      setBackupSize(null);
      setBackupWarningOpen(true);
      setDownloading(false);
      return;
    }
    await doDownload();
  }

  async function doDownload() {
    setBackupWarningOpen(false);
    setDownloading(true);
    try {
      const params = includeAudiobooks ? { includeAudiobooks: 'true' } : {};
      const response = await api.get('/admin/library/backup/download', {
        params,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `litara-backup-${dateStr}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const reorganizeDisabled =
    !diskSettings ||
    !diskSettings.allowDiskWrites ||
    diskSettings.isReadOnlyMount;

  const reorganizeTooltip = !diskSettings
    ? ''
    : !diskSettings.allowDiskWrites
      ? 'Enable disk writes in settings to use this feature'
      : diskSettings.isReadOnlyMount
        ? 'Library volume is mounted read-only'
        : '';

  const formatBytes = (bytes: number) => {
    if (bytes >= TWO_GIB)
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Library Management</Title>
          <Text size="sm" c="dimmed">
            Reorganize your library files into the canonical{' '}
            <code>Author/[Series/]Title.ext</code> folder structure, or download
            a full backup as a zip archive.
          </Text>

          <Group gap="sm" wrap="wrap">
            <Tooltip
              label={reorganizeTooltip}
              disabled={!reorganizeTooltip}
              withArrow
            >
              <span>
                <Button
                  leftSection={<IconFolderSearch size={16} />}
                  variant="light"
                  disabled={reorganizeDisabled}
                  loading={reorganizing}
                  onClick={() => void handleReorganizeClick()}
                >
                  Reorganize Library
                </Button>
              </span>
            </Tooltip>

            <Button
              leftSection={<IconDownload size={16} />}
              variant="light"
              loading={downloading}
              onClick={() => void handleBackupClick()}
            >
              Download Backup
            </Button>
            <Checkbox
              label="Include audiobook files"
              checked={includeAudiobooks}
              onChange={(e) => setIncludeAudiobooks(e.currentTarget.checked)}
            />
          </Group>

          {reorganizeResult === 'success' && (
            <Alert icon={<IconCheck size={16} />} color="green" variant="light">
              Reorganize task started. Check the Tasks tab to monitor progress.
            </Alert>
          )}
          {reorganizeResult === 'error' && (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="red"
              variant="light"
            >
              Failed to start reorganize. Check server logs for details.
            </Alert>
          )}
        </Stack>
      </Paper>

      <Modal
        opened={reorganizeConfirmOpen}
        onClose={() => setReorganizeConfirmOpen(false)}
        title="Reorganize Library"
        size="md"
      >
        <Stack gap="sm">
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="yellow"
            variant="light"
          >
            <Stack gap="xs">
              <Text size="sm">
                This will physically move files on disk into the canonical{' '}
                <code>Author/[Series/]Title.ext</code> folder structure. Files
                already in the correct location will be skipped. This action
                cannot be automatically undone — consider downloading a backup
                first.
              </Text>
              <Text size="sm" fw={500}>
                Files that will be moved:
              </Text>
              <Text
                size="sm"
                component="ul"
                style={{ margin: 0, paddingLeft: '1.25rem' }}
              >
                <li>
                  Ebook files (<code>.epub</code>, <code>.mobi</code>, etc.)
                </li>
                <li>
                  Litara sidecar files (<code>.metadata.json</code>) — moved
                  alongside their ebook
                </li>
              </Text>
              <Text size="sm" fw={500}>
                Files that will NOT be moved:
              </Text>
              <Text
                size="sm"
                component="ul"
                style={{ margin: 0, paddingLeft: '1.25rem' }}
              >
                <li>
                  KOReader progress directories (<code>.sdr/</code>) — these
                  will be orphaned if present. This is not related to Litara's
                  KOReader Sync feature, which does not use on-disk files and
                  will continue to work after reorganizing.
                </li>
                <li>
                  Any other third-party files placed alongside your ebooks
                </li>
              </Text>
            </Stack>
          </Alert>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => setReorganizeConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={() => void handleReorganizeConfirm()}
            >
              Start Reorganize
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={backupWarningOpen}
        onClose={() => {
          setBackupWarningOpen(false);
          setDownloading(false);
        }}
        title="Large Backup Warning"
        size="sm"
      >
        <Stack gap="sm">
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="yellow"
            variant="light"
          >
            {backupSize !== null
              ? `This backup is approximately ${formatBytes(backupSize)} — large downloads may time out depending on your network and server configuration.`
              : 'Could not determine backup size. The download may be large and could time out.'}
          </Alert>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => {
                setBackupWarningOpen(false);
                setDownloading(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void doDownload()}>Download Anyway</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function GeneralTab({
  onTaskStarted,
}: {
  onTaskStarted?: () => void;
} = {}) {
  return (
    <Stack gap="lg">
      <UserManagementSection />
      <OpdsCatalogSection />
      <KoReaderSyncSection />
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Email / SMTP</Title>
          <Text size="sm" c="dimmed">
            Server-level outgoing mail configuration. Used as a fallback for
            users who have not set up their own SMTP in Settings.
          </Text>
          <SmtpConfigForm
            configPath="/settings/smtp"
            testPath="/settings/smtp/test"
          />
        </Stack>
      </Paper>
      <ShelfmarkSettingsSection />
      <LibraryScanSection />
      <AuthorPhotoEnrichmentSection />
      <DiskSettingsSection />
      {import.meta.env.DEV && <DevToolsSection />}
      <LibraryManagementSection onTaskStarted={onTaskStarted} />
    </Stack>
  );
}
