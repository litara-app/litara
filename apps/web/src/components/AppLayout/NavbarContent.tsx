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
} from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { api } from '../../utils/api';
import { librariesAtom, shelvesAtom } from '../../store/atoms';
import type { Library, Shelf } from '../../store/atoms';

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

export function NavbarContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [librariesOpen, setLibrariesOpen] = useState(false);
  const [shelvesOpen, setShelvesOpen] = useState(false);
  const [libraries, setLibraries] = useAtom(librariesAtom);
  const [shelves, setShelves] = useAtom(shelvesAtom);

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') ?? '{}');
    } catch {
      return {};
    }
  })();

  useEffect(() => {
    void api.get<Library[]>('/libraries').then((r) => setLibraries(r.data));
    void api.get<Shelf[]>('/shelves').then((r) => setShelves(r.data));
  }, [setLibraries, setShelves]);

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
          onClick={() => navigate('/')}
        />

        <NavLink
          label="All Books"
          leftSection={<IconBook size={18} />}
          active={location.pathname === '/books'}
          onClick={() => navigate('/books')}
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
              onClick={() => navigate(`/library/${lib.id}`)}
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
              onClick={() => navigate(`/shelf/${shelf.id}`)}
            />
          ))}
          <Box>
            <AddButton
              label="New Shelf"
              onClick={() => void handleCreateShelf()}
            />
          </Box>
        </NavLink>
      </ScrollArea>

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
    </Stack>
  );
}
