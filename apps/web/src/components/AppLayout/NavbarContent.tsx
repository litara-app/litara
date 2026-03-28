import { useState, useEffect } from 'react';
import {
  NavLink,
  ScrollArea,
  Divider,
  Stack,
  UnstyledButton,
  Text,
  Box,
  Avatar,
  Group,
  ActionIcon,
  Modal,
  TextInput,
  Button,
  Anchor,
  Code,
} from '@mantine/core';
import {
  IconHome,
  IconBook,
  IconBooks,
  IconBookmarks,
  IconSettings,
  IconShieldCog,
  IconLogout,
  IconLibrary,
  IconPlus,
  IconTimeline,
  IconFlask,
  IconAdjustments,
  IconArrowUpCircle,
} from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { api } from '../../utils/api';
import {
  librariesAtom,
  shelvesAtom,
  userSettingsAtom,
  updateAvailableAtom,
  versionCheckResultAtom,
} from '../../store/atoms';
import type { Library, Shelf } from '../../store/atoms';
import type { VersionCheckResult } from '../../types/server';
import { SmartShelfModal } from '../SmartShelfModal';
import { DashboardSettingsModal } from '../DashboardSettingsModal';
import type { SmartShelfSummary } from '../../types/smartShelf';
import type { SmartShelfDetail } from '../../types/smartShelf';
import { pushToast } from '../../utils/toast';

function nextName(existing: string[], prefix: string): string {
  const names = new Set(existing);
  let n = 1;
  while (names.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        width: '100%',
        color: 'var(--mantine-color-dimmed)',
        fontSize: 'var(--mantine-font-size-xs)',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background =
          'var(--mantine-color-gray-1)')
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLElement).style.background = 'transparent')
      }
    >
      <IconPlus size={12} />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </UnstyledButton>
  );
}

interface NavItemSettingsModalProps {
  opened: boolean;
  onClose: () => void;
  label: string;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

function NavItemSettingsModal({
  opened,
  onClose,
  label,
  onRename,
  onDelete,
}: NavItemSettingsModalProps) {
  const [name, setName] = useState(label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (opened) {
      setName(label);
      setConfirmDelete(false);
    }
  }, [opened, label]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === label) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Settings"
      size="sm"
      centered
    >
      <Stack gap="md">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave();
          }}
        />
        <Button onClick={() => void handleSave()} loading={saving} fullWidth>
          Save
        </Button>
        <Divider />
        {confirmDelete ? (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Are you sure? This cannot be undone.
            </Text>
            <Group grow>
              <Button variant="default" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                color="red"
                onClick={() => void handleDelete()}
                loading={deleting}
              >
                Confirm Delete
              </Button>
            </Group>
          </Stack>
        ) : (
          <Button
            color="red"
            variant="light"
            onClick={() => void handleDelete()}
            fullWidth
          >
            Delete
          </Button>
        )}
      </Stack>
    </Modal>
  );
}

interface NavItemWithSettingsProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function NavItemWithSettings({
  id,
  label,
  icon,
  active,
  onClick,
  onRename,
  onDelete,
}: NavItemWithSettingsProps) {
  const [hovered, setHovered] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  function handleSettingsClick(e: React.MouseEvent) {
    e.stopPropagation();
    setModalOpen(true);
  }

  return (
    <>
      <NavLink
        label={label}
        leftSection={icon}
        active={active}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        rightSection={
          hovered ? (
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={handleSettingsClick}
            >
              <IconAdjustments size={14} />
            </ActionIcon>
          ) : undefined
        }
      />
      <NavItemSettingsModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        label={label}
        onRename={(newName) => onRename(id, newName)}
        onDelete={() => onDelete(id)}
      />
    </>
  );
}

interface SmartShelfNavItemProps {
  shelf: SmartShelfSummary;
  active: boolean;
  onClick: () => void;
  onSaved: () => void;
  onDeleted: (id: string) => void;
}

function SmartShelfNavItem({
  shelf,
  active,
  onClick,
  onSaved,
  onDeleted,
}: SmartShelfNavItemProps) {
  const [hovered, setHovered] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState<SmartShelfDetail | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  async function openSettings(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await api.get<SmartShelfDetail>(`/smart-shelves/${shelf.id}`);
    setDetail(res.data);
    setModalOpen(true);
  }

  async function handleDelete() {
    await api.delete(`/smart-shelves/${shelf.id}`);
    if (location.pathname === `/smart-shelves/${shelf.id}`) navigate('/');
    onDeleted(shelf.id);
    pushToast('Smart shelf deleted', { color: 'green' });
  }

  return (
    <>
      <NavLink
        label={shelf.name}
        leftSection={<IconFlask size={16} />}
        active={active}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        rightSection={
          hovered ? (
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={(e) => void openSettings(e)}
            >
              <IconAdjustments size={14} />
            </ActionIcon>
          ) : undefined
        }
      />
      {detail && (
        <SmartShelfModal
          opened={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setDetail(null);
          }}
          onSaved={() => {
            onSaved();
            setDetail(null);
          }}
          shelf={detail}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}

interface DashboardNavItemProps {
  active: boolean;
  onClick: () => void;
}

function DashboardNavItem({ active, onClick }: DashboardNavItemProps) {
  const [hovered, setHovered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userSettings, setUserSettings] = useAtom(userSettingsAtom);

  async function saveLayout(newLayout: typeof userSettings.dashboardLayout) {
    setUserSettings((prev) => ({ ...prev, dashboardLayout: newLayout }));
    setSettingsOpen(false);
    await api.patch('/users/me/settings', { dashboardLayout: newLayout });
  }

  return (
    <>
      <NavLink
        label="Dashboard"
        leftSection={<IconHome size={18} />}
        active={active}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        rightSection={
          hovered ? (
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen(true);
              }}
            >
              <IconAdjustments size={14} />
            </ActionIcon>
          ) : undefined
        }
      />
      <DashboardSettingsModal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        layout={userSettings.dashboardLayout}
        onSave={(layout) => void saveLayout(layout)}
      />
    </>
  );
}

export function NavbarContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [librariesOpen, setLibrariesOpen] = useState(false);
  const [shelvesOpen, setShelvesOpen] = useState(false);
  const [smartShelvesOpen, setSmartShelvesOpen] = useState(false);
  const [libraries, setLibraries] = useAtom(librariesAtom);
  const [shelves, setShelves] = useAtom(shelvesAtom);
  const [smartShelves, setSmartShelves] = useState<SmartShelfSummary[]>([]);
  const [smartShelfModalOpen, setSmartShelfModalOpen] = useState(false);

  const updateAvailable = useAtomValue(updateAvailableAtom);
  const versionCheckResult = useAtomValue(versionCheckResultAtom);
  const setUpdateAvailable = useSetAtom(updateAvailableAtom);
  const setVersionCheckResult = useSetAtom(versionCheckResultAtom);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') ?? '{}');
    } catch {
      return {};
    }
  })();

  const loadSmartShelves = () => {
    void api
      .get<SmartShelfSummary[]>('/smart-shelves')
      .then((r) => setSmartShelves(r.data));
  };

  useEffect(() => {
    void api.get<Library[]>('/libraries').then((r) => setLibraries(r.data));
    void api.get<Shelf[]>('/shelves').then((r) => setShelves(r.data));
    loadSmartShelves();
  }, [setLibraries, setShelves]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    void api
      .get<VersionCheckResult>('/server/version-check')
      .then((r) => {
        setVersionCheckResult(r.data);
        setUpdateAvailable(r.data.updateAvailable);
      })
      .catch(() => {});
  }, [setVersionCheckResult, setUpdateAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  async function handleCreateLibrary() {
    const name = nextName(
      libraries.map((l) => l.name),
      'Library',
    );
    const res = await api.post<Library>('/libraries', { name });
    setLibraries((prev) => [...prev, res.data]);
    setLibrariesOpen(true);
    navigate(`/library/${res.data.id}`);
  }

  async function handleCreateShelf() {
    const name = nextName(
      shelves.map((s) => s.name),
      'Shelf',
    );
    const res = await api.post<Shelf>('/shelves', { name });
    setShelves((prev) => [...prev, res.data]);
    setShelvesOpen(true);
    navigate(`/shelf/${res.data.id}`);
  }

  async function handleRenameLibrary(id: string, name: string) {
    await api.patch(`/libraries/${id}`, { name });
    setLibraries((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
    pushToast('Library renamed', { color: 'green' });
  }

  async function handleDeleteLibrary(id: string) {
    await api.delete(`/libraries/${id}`);
    setLibraries((prev) => prev.filter((l) => l.id !== id));
    if (location.pathname === `/library/${id}`) navigate('/');
    pushToast('Library deleted', { color: 'green' });
  }

  async function handleRenameShelf(id: string, name: string) {
    await api.patch(`/shelves/${id}`, { name });
    setShelves((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    pushToast('Shelf renamed', { color: 'green' });
  }

  async function handleDeleteShelf(id: string) {
    await api.delete(`/shelves/${id}`);
    setShelves((prev) => prev.filter((s) => s.id !== id));
    if (location.pathname === `/shelf/${id}`) navigate('/');
    pushToast('Shelf deleted', { color: 'green' });
  }

  function handleSmartShelfDeleted(id: string) {
    setSmartShelves((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <Stack h="100%" gap={0}>
      <ScrollArea style={{ flex: 1 }}>
        <DashboardNavItem
          active={location.pathname === '/'}
          onClick={() => navigate('/')}
        />

        <NavLink
          label="All Books"
          leftSection={<IconBook size={18} />}
          active={location.pathname === '/books'}
          onClick={() => navigate('/books')}
        />

        <NavLink
          label="Series"
          leftSection={<IconTimeline size={18} />}
          active={location.pathname === '/series'}
          onClick={() => navigate('/series')}
        />

        <NavLink
          label="Libraries"
          leftSection={<IconBooks size={18} />}
          childrenOffset={28}
          opened={librariesOpen}
          onChange={setLibrariesOpen}
        >
          {libraries.map((lib) => (
            <NavItemWithSettings
              key={lib.id}
              id={lib.id}
              label={lib.name}
              icon={<IconLibrary size={16} />}
              active={location.pathname === `/library/${lib.id}`}
              onClick={() => navigate(`/library/${lib.id}`)}
              onRename={handleRenameLibrary}
              onDelete={handleDeleteLibrary}
            />
          ))}
          <Box>
            <AddButton
              label="New Library"
              onClick={() => void handleCreateLibrary()}
            />
          </Box>
        </NavLink>

        <NavLink
          label="Shelves"
          leftSection={<IconBookmarks size={18} />}
          childrenOffset={28}
          opened={shelvesOpen}
          onChange={setShelvesOpen}
        >
          {shelves.map((shelf) => (
            <NavItemWithSettings
              key={shelf.id}
              id={shelf.id}
              label={shelf.name}
              icon={<IconBookmarks size={16} />}
              active={location.pathname === `/shelf/${shelf.id}`}
              onClick={() => navigate(`/shelf/${shelf.id}`)}
              onRename={handleRenameShelf}
              onDelete={handleDeleteShelf}
            />
          ))}
          <Box>
            <AddButton
              label="New Shelf"
              onClick={() => void handleCreateShelf()}
            />
          </Box>
        </NavLink>

        <NavLink
          label="Smart Shelves"
          leftSection={<IconFlask size={18} />}
          childrenOffset={28}
          opened={smartShelvesOpen}
          onChange={setSmartShelvesOpen}
        >
          {smartShelves.map((s) => (
            <SmartShelfNavItem
              key={s.id}
              shelf={s}
              active={location.pathname === `/smart-shelves/${s.id}`}
              onClick={() => navigate(`/smart-shelves/${s.id}`)}
              onSaved={loadSmartShelves}
              onDeleted={handleSmartShelfDeleted}
            />
          ))}
          <Box>
            <AddButton
              label="New Smart Shelf"
              onClick={() => setSmartShelfModalOpen(true)}
            />
          </Box>
        </NavLink>
      </ScrollArea>

      {smartShelfModalOpen && (
        <SmartShelfModal
          opened={smartShelfModalOpen}
          onClose={() => setSmartShelfModalOpen(false)}
          onSaved={() => {
            loadSmartShelves();
            setSmartShelvesOpen(true);
          }}
        />
      )}

      <NavLink
        label="Settings"
        leftSection={<IconSettings size={18} />}
        active={location.pathname === '/settings'}
        onClick={() => navigate('/settings')}
      />
      {user?.role === 'ADMIN' && (
        <NavLink
          label="Admin Settings"
          leftSection={<IconShieldCog size={18} />}
          active={location.pathname === '/admin-settings'}
          onClick={() => navigate('/admin-settings')}
        />
      )}

      <Divider />

      <UnstyledButton
        onClick={() => navigate('/profile')}
        p="sm"
        w="100%"
        style={{
          borderRadius: 'var(--mantine-radius-sm)',
          background:
            location.pathname === '/profile'
              ? 'var(--mantine-color-gray-1)'
              : undefined,
        }}
      >
        <Group>
          <Avatar
            radius="xl"
            size="sm"
            name={user?.name ?? user?.email}
            color="initials"
          />
          <div style={{ flex: 1 }}>
            <Text size="sm" fw={500}>
              {user?.name ?? 'Account'}
            </Text>
            {user?.email && (
              <Text size="xs" c="dimmed">
                {user.email}
              </Text>
            )}
          </div>
        </Group>
      </UnstyledButton>
      <NavLink
        label="Logout"
        leftSection={<IconLogout size={18} />}
        color="red"
        onClick={handleLogout}
      />
      {updateAvailable && versionCheckResult ? (
        <UnstyledButton
          onClick={() => setUpdateModalOpen(true)}
          w="100%"
          py={4}
        >
          <Group justify="center" gap={4}>
            <IconArrowUpCircle size={14} color="var(--mantine-color-green-6)" />
            <Text size="xs" c="green" style={{ userSelect: 'none' }}>
              v{versionCheckResult.latestVersion} available
            </Text>
          </Group>
        </UnstyledButton>
      ) : (
        <Text
          size="xs"
          c="dimmed"
          ta="center"
          py={4}
          style={{ userSelect: 'none' }}
        >
          v{__APP_VERSION__}
        </Text>
      )}

      <Modal
        opened={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        title={`Update available — v${versionCheckResult?.latestVersion ?? ''}`}
        size="lg"
      >
        <Stack gap="md">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Current version:
            </Text>
            <Text size="sm">v{__APP_VERSION__}</Text>
            <Text size="sm" c="dimmed">
              → New version:
            </Text>
            <Text size="sm" c="green" fw={500}>
              v{versionCheckResult?.latestVersion}
            </Text>
          </Group>
          {versionCheckResult?.releaseUrl && (
            <Anchor
              href={versionCheckResult.releaseUrl}
              target="_blank"
              size="sm"
            >
              View release on GitHub
            </Anchor>
          )}
          {versionCheckResult?.releaseNotes && (
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
                maxHeight: 500,
                overflowY: 'auto',
              }}
            >
              {versionCheckResult.releaseNotes}
            </Code>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
