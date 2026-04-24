import { atom } from 'jotai';
import type { VersionCheckResult } from '../types/server';
import type { SmartShelfSummary } from '../types/smartShelf';

export interface Library {
  id: string;
  name: string;
}

export interface Shelf {
  id: string;
  name: string;
}

export interface DashboardSection {
  key: 'currently-reading' | 'recently-added' | 'reading-queue';
  label: string;
  visible: boolean;
  order: number;
}

export type ProgressDisplaySource =
  | 'HIGHEST'
  | 'MOST_RECENT'
  | 'KOREADER'
  | 'LITARA';

export interface UserSettings {
  dashboardLayout: DashboardSection[];
  bookItemSize: 'sm' | 'md' | 'lg' | 'xl';
  progressDisplaySource: ProgressDisplaySource;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  dashboardLayout: [
    { key: 'reading-queue', label: 'Reading Queue', visible: true, order: 0 },
    {
      key: 'currently-reading',
      label: 'Currently Reading',
      visible: true,
      order: 1,
    },
    { key: 'recently-added', label: 'Recently Added', visible: true, order: 2 },
  ],
  bookItemSize: 'md',
  progressDisplaySource: 'HIGHEST',
};

export interface Toast {
  id: string;
  message: string;
  title?: string;
  color?: string;
}

export interface ReadingQueueItem {
  id: string;
  bookId: string;
  position: number;
  addedAt: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
  hasFileMissing: boolean;
}

export const librariesAtom = atom<Library[]>([]);
export const shelvesAtom = atom<Shelf[]>([]);
export const selectedBookIdsAtom = atom<Set<string>>(new Set<string>());
export const isSelectModeAtom = atom<boolean>(
  (get) => get(selectedBookIdsAtom).size > 0,
);
export const smartShelvesAtom = atom<SmartShelfSummary[]>([]);
export const userSettingsAtom = atom<UserSettings>(DEFAULT_USER_SETTINGS);
export const backendStatusAtom = atom<'ok' | 'error'>('ok');
export const toastsAtom = atom<Toast[]>([]);
export const updateAvailableAtom = atom<boolean>(false);
export const versionCheckResultAtom = atom<VersionCheckResult | null>(null);
export const pendingBookCountAtom = atom<number>(0);
export const readingQueueAtom = atom<ReadingQueueItem[]>([]);

export interface AudiobookChapterInfo {
  index: number;
  title: string;
  startTime: number;
  endTime: number | null;
}

export interface AudiobookFileInfo {
  id: string;
  fileIndex: number;
  duration: number;
  mimeType: string;
  narrator: string | null;
  chapters: AudiobookChapterInfo[];
}

export interface AudiobookProgressInfo {
  currentFileIndex: number;
  currentTime: number;
  totalDuration: number;
  completedAt: string | null;
}

export interface AudiobookPlayerState {
  bookId: string;
  bookTitle: string;
  hasCover: boolean;
  narrator: string | null;
  audiobookFiles: AudiobookFileInfo[];
  initialProgress: AudiobookProgressInfo | null;
}

export const audiobookPlayerAtom = atom<AudiobookPlayerState | null>(null);
