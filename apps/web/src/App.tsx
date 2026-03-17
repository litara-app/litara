import { MantineProvider } from '@mantine/core';
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
import { UserSettingsPage } from './pages/UserSettingsPage';
import { AllBooksPage } from './pages/AllBooksPage';
import { AppLayout } from './components/AppLayout/AppLayout';

function ProtectedRoute() {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/books" element={<AllBooksPage />} />
              <Route path="/library/:id" element={<LibraryPage />} />
              <Route path="/shelf/:id" element={<ShelfPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/user-settings" element={<UserSettingsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </MantineProvider>
  );
}
