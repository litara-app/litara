import { Alert, Stack, Tabs, Title } from "@mantine/core";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/session";

// Administration is for administrators only; the server enforces this on every
// route (administrator AND a library grant), this guard only avoids dead ends.
export function AdminLayout() {
  const { user } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  if (!user?.isAdmin) return <Alert color="red" title="Administrators only">Your account is not an administrator.</Alert>;
  const tab = loc.pathname.startsWith("/admin/libraries") ? "libraries" : loc.pathname.startsWith("/admin/repairs") ? "repairs" : "users";
  return (
    <Stack>
      <Title order={2}>Administration</Title>
      <Tabs value={tab} onChange={(v) => nav(v === "users" ? "/admin" : `/admin/${v}`)}>
        <Tabs.List>
          <Tabs.Tab value="users">Users</Tabs.Tab>
          <Tabs.Tab value="libraries">Libraries</Tabs.Tab>
          <Tabs.Tab value="repairs">Recording repair</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Outlet />
    </Stack>
  );
}
