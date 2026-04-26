import { useState, useEffect, useCallback } from 'react';
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
  Modal,
  Anchor,
  Code,
  Indicator,
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
  IconUsers,
  IconFlask,
  IconArrowUpCircle,
  IconUpload,
  IconClipboardCheck,
} from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { api } from '../../utils/api';
import {
  librariesAtom,
  shelvesAtom,
  smartShelvesAtom,
  updateAvailableAtom,
  versionCheckResultAtom,
  pendingBookCountAtom,
} from '../../store/atoms';
import type { Library, Shelf } from '../../store/atoms';
import type { VersionCheckResult } from '../../types/server';
import { SmartShelfModal } from '../SmartShelfModal';
import type { SmartShelfSummary } from '../../types/smartShelf';

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

interface NavbarContentProps {
  onNavigate?: () => void;
}

export function NavbarContent({ onNavigate }: NavbarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [librariesOpen, setLibrariesOpen] = useState(false);
  const [shelvesOpen, setShelvesOpen] = useState(false);
  const [smartShelvesOpen, setSmartShelvesOpen] = useState(false);
  const [libraries, setLibraries] = useAtom(librariesAtom);
  const [shelves, setShelves] = useAtom(shelvesAtom);
  const [smartShelves, setSmartShelves] = useAtom(smartShelvesAtom);
  const [smartShelfModalOpen, setSmartShelfModalOpen] = useState(false);

  const [pendingCount, setPendingCount] = useAtom(pendingBookCountAtom);

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

  const loadSmartShelves = useCallback(() => {
    void api
      .get<SmartShelfSummary[]>('/smart-shelves')
      .then((r) => setSmartShelves(r.data))
      .catch(() => {});
  }, [setSmartShelves]);

  useEffect(() => {
    void Promise.all([
      api.get<Library[]>('/libraries').then((r) => setLibraries(r.data)),
      api.get<Shelf[]>('/shelves').then((r) => setShelves(r.data)),
      loadSmartShelves(),
      ...(user?.role === 'ADMIN'
        ? [
            api
              .get<{ id: string }[]>('/book-drop/pending')
              .then((r) => setPendingCount(r.data.length))
              .catch(() => {}),
          ]
        : []),
    ]);
  }, [setLibraries, setShelves, loadSmartShelves, setPendingCount, user?.role]);

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

  return (
    <Stack h="100%" gap={0}>
      <ScrollArea style={{ flex: 1 }}>
        <NavLink
          label="Dashboard"
          leftSection={<IconHome size={18} />}
          active={location.pathname === '/'}
          onClick={() => {
            navigate('/');
            onNavigate?.();
          }}
        />

        <NavLink
          label="All Books"
          leftSection={<IconBook size={18} />}
          active={location.pathname === '/books'}
          onClick={() => {
            navigate('/books');
            onNavigate?.();
          }}
        />

        <NavLink
          label="Series"
          leftSection={<IconTimeline size={18} />}
          active={location.pathname === '/series'}
          onClick={() => {
            navigate('/series');
            onNavigate?.();
          }}
        />

        <NavLink
          label="Authors"
          leftSection={<IconUsers size={18} />}
          active={location.pathname === '/authors'}
          onClick={() => {
            navigate('/authors');
            onNavigate?.();
          }}
        />

        <NavLink
          label="Annotations"
          leftSection={<IconBookmarks size={18} />}
          active={location.pathname === '/annotations'}
          onClick={() => {
            navigate('/annotations');
            onNavigate?.();
          }}
        />

        <NavLink
          label="Libraries"
          leftSection={<IconBooks size={18} />}
          childrenOffset={28}
          opened={librariesOpen}
          onChange={setLibrariesOpen}
        >
          {libraries.map((lib) => (
            <NavLink
              key={lib.id}
              label={lib.name}
              leftSection={<IconLibrary size={16} />}
              active={location.pathname === `/library/${lib.id}`}
              onClick={() => {
                navigate(`/library/${lib.id}`);
                onNavigate?.();
              }}
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
            <NavLink
              key={shelf.id}
              label={shelf.name}
              leftSection={<IconBookmarks size={16} />}
              active={location.pathname === `/shelf/${shelf.id}`}
              onClick={() => {
                navigate(`/shelf/${shelf.id}`);
                onNavigate?.();
              }}
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
            <NavLink
              key={s.id}
              label={s.name}
              leftSection={<IconFlask size={16} />}
              active={location.pathname === `/smart-shelves/${s.id}`}
              onClick={() => {
                navigate(`/smart-shelves/${s.id}`);
                onNavigate?.();
              }}
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
        label="Book Drop"
        leftSection={<IconUpload size={18} />}
        active={location.pathname === '/book-drop'}
        onClick={() => {
          navigate('/book-drop');
          onNavigate?.();
        }}
      />

      {user?.role === 'ADMIN' && (
        <Indicator
          label={pendingCount}
          size={18}
          disabled={pendingCount === 0}
          color="red"
          offset={4}
        >
          <NavLink
            label="Book Review"
            leftSection={<IconClipboardCheck size={18} />}
            active={location.pathname === '/admin/book-review'}
            onClick={() => {
              navigate('/admin/book-review');
              onNavigate?.();
            }}
          />
        </Indicator>
      )}

      <NavLink
        label="Settings"
        leftSection={<IconSettings size={18} />}
        active={location.pathname === '/settings'}
        onClick={() => {
          navigate('/settings');
          onNavigate?.();
        }}
      />
      {user?.role === 'ADMIN' && (
        <NavLink
          label="Admin Settings"
          leftSection={<IconShieldCog size={18} />}
          active={location.pathname === '/admin-settings'}
          onClick={() => {
            navigate('/admin-settings');
            onNavigate?.();
          }}
        />
      )}

      <Divider />

      <UnstyledButton
        onClick={() => {
          navigate('/profile');
          onNavigate?.();
        }}
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
