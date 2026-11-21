import { Outlet } from "react-router";
import { useAuth } from "../auth/session";
import { Alert, NavTabs, Page, PageHeader } from "../ui";

// Administration is for administrators only; the server enforces this on every
// route (administrator AND a library grant), this guard only avoids dead ends.
export function AdminLayout() {
  const { user } = useAuth();
  if (!user?.isAdmin) return <Page><Alert tone="danger" title="Administrators only">Your account is not an administrator.</Alert></Page>;
  return (
    <Page>
      <PageHeader title="Administration" />
      <NavTabs label="Administration sections" items={[
        { to: "/admin", label: "Users", end: true },
        { to: "/admin/libraries", label: "Libraries" },
        { to: "/admin/repairs", label: "Recording repair" },
        { to: "/admin/integrations", label: "Integrations" },
      ]} />
      <Outlet />
    </Page>
  );
}
