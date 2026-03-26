import { MantineProvider, createTheme } from '@mantine/core';

const theme = createTheme({ cursorType: 'pointer' });
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from 'react-router-dom';
import '@mantine/core/styles.css';

import { Login } from './pages/Login';
import { SetupPage } from './pages/SetupPage';
import { Dashboard } from './pages/Dashboard';
import { LibraryPage } from './pages/LibraryPage';
import { ShelfPage } from './pages/ShelfPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminSettingsPage } from './pages/AdminSettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { AllBooksPage } from './pages/AllBooksPage';
import { SeriesPage } from './pages/SeriesPage';
import { SmartShelfPage } from './pages/SmartShelfPage';
import { AppLayout } from './components/AppLayout/AppLayout';
import { ToastContainer } from './components/ToastContainer';

function ProtectedRoute() {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ToastContainer />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/books" element={<AllBooksPage />} />
              <Route path="/series" element={<SeriesPage />} />
              <Route path="/library/:id" element={<LibraryPage />} />
              <Route path="/shelf/:id" element={<ShelfPage />} />
              <Route path="/smart-shelves/:id" element={<SmartShelfPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin-settings" element={<AdminSettingsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              {/* Legacy redirects */}
              <Route
                path="/user-settings"
                element={<Navigate to="/settings" replace />}
              />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </MantineProvider>
  );
}
