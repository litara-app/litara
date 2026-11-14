import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./auth/session";
import { AdminLayout } from "./admin/AdminLayout";
import { LibrariesPage, LibraryAdminPage } from "./admin/LibrariesPage";
import { RepairPage, RepairPlanPage } from "./admin/RepairPage";
import { UsersPage } from "./admin/UsersPage";
import { EditionPage } from "./pages/EditionPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { ShelfPage } from "./pages/ShelfPage";
import { ShelvesPage } from "./pages/ShelvesPage";
import { TitlePage } from "./pages/TitlePage";
import { PendingPage } from "./pending/PendingPage";
import { ReaderPage } from "./reader/ReaderPage";
import { Busy } from "./ui/common";
import { Shell } from "./ui/Shell";

// Compiled only for proof builds; tree-shaken from production.
const ProofPage = import.meta.env.VITE_READER_PROOF
  ? lazy(() => import("./reader/ProofPage").then((m) => ({ default: m.ProofPage })))
  : null;

function RequireAuth({ shell = true }: { shell?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Busy />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return shell ? <Shell /> : <Outlet />;
}

// The in-browser reader, annotations UI, audio player, administration and
// review screens arrive in later T005 milestones; this is not a complete app.
export function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        {ProofPage && <Route path="/read/proof" element={<ProofPage />} />}
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth shell={false} />}>
          <Route path="read/:editionId" element={<ReaderPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route index element={<LibraryPage />} />
          <Route path="titles/:titleId" element={<TitlePage />} />
          <Route path="editions/:editionId" element={<EditionPage />} />
          <Route path="pending" element={<PendingPage />} />
          <Route path="shelves" element={<ShelvesPage />} />
          <Route path="shelves/:shelfId" element={<ShelfPage />} />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<UsersPage />} />
            <Route path="libraries" element={<LibrariesPage />} />
            <Route path="libraries/:libraryId" element={<LibraryAdminPage />} />
            <Route path="repairs" element={<RepairPage />} />
            <Route path="repairs/:planId" element={<RepairPlanPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
