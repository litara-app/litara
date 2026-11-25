import { Outlet } from "react-router";
import { NavTabs, Page, PageHeader } from "../ui";

// Personal integration settings. Every account can open this; what each tab can
// do is decided by the server (grants, enabled services, ownership).
export function SettingsLayout() {
  return (
    <Page>
      <PageHeader title="Settings" />
      <NavTabs label="Settings sections" items={[
        { to: "/settings", label: "Appearance", end: true },
        { to: "/settings/devices", label: "Devices" },
        { to: "/settings/credentials", label: "App credentials" },
        { to: "/settings/email", label: "Email" },
        { to: "/settings/koreader", label: "KOReader" },
        { to: "/settings/notifications", label: "Notifications" },
      ]} />
      <Outlet />
    </Page>
  );
}
