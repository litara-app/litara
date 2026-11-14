import { AppShell, Burger, Button, Group, NavLink, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/session";

export function Shell() {
  const [open, { toggle, close }] = useDisclosure();
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const items = [
    { to: "/", label: "Library" },
    { to: "/shelves", label: "Shelves" },
  ];
  const libraryActive = loc.pathname === "/" || loc.pathname.startsWith("/titles") || loc.pathname.startsWith("/editions");
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !open } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={open} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Text fw={700} component={Link} to="/" style={{ textDecoration: "none", color: "inherit" }}>Litara</Text>
          </Group>
          <Group>
            <Text size="sm" data-testid="whoami">{user?.displayName || user?.username}</Text>
            <Button variant="default" size="xs" onClick={async () => { await logout(); nav("/login"); }}>Sign out</Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        {items.map((i) => (
          <NavLink key={i.to} component={Link} to={i.to} label={i.label} onClick={close}
            active={i.to === "/" ? libraryActive : loc.pathname.startsWith(i.to)} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main><Outlet /></AppShell.Main>
    </AppShell>
  );
}
