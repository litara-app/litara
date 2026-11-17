import { Stack, Tabs, Title } from "@mantine/core";
import { Outlet, useLocation, useNavigate } from "react-router";

// Personal integration settings. Every account can open this; what each tab can
// do is decided by the server (grants, enabled services, ownership).
export function SettingsLayout() {
  const loc = useLocation();
  const nav = useNavigate();
  const tab = loc.pathname.startsWith("/settings/email") ? "email" : loc.pathname.startsWith("/settings/koreader") ? "koreader" : "credentials";
  return (
    <Stack>
      <Title order={2}>Settings</Title>
      <Tabs value={tab} onChange={(v) => nav(v === "credentials" ? "/settings" : `/settings/${v}`)}>
        <Tabs.List>
          <Tabs.Tab value="credentials">App credentials</Tabs.Tab>
          <Tabs.Tab value="email">Email</Tabs.Tab>
          <Tabs.Tab value="koreader">KOReader</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Outlet />
    </Stack>
  );
}
