import { atom } from 'jotai';

export interface Library {
  id: string;
  name: string;
}

export interface Shelf {
  id: string;
  name: string;
}

export interface DashboardSection {
  key: 'currently-reading' | 'recently-added';
  label: string;
  visible: boolean;
  order: number;
}

export interface UserSettings {
  dashboardLayout: DashboardSection[];
  bookItemSize: 'sm' | 'md' | 'lg' | 'xl';
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  dashboardLayout: [
    {
      key: 'currently-reading',
      label: 'Currently Reading',
      visible: true,
      order: 0,
    },
    { key: 'recently-added', label: 'Recently Added', visible: true, order: 1 },
  ],
  bookItemSize: 'md',
};

export interface Toast {
  id: string;
  message: string;
  title?: string;
  color?: string;
}

export const librariesAtom = atom<Library[]>([]);
export const shelvesAtom = atom<Shelf[]>([]);
export const userSettingsAtom = atom<UserSettings>(DEFAULT_USER_SETTINGS);
export const backendStatusAtom = atom<'ok' | 'error'>('ok');
export const toastsAtom = atom<Toast[]>([]);
