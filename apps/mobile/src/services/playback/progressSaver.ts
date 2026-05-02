import TrackPlayer, { Event } from 'react-native-track-player';
import { writePendingProgress, pendingProgressKey } from './pendingProgress';
import { setActiveBookId, activeBookId } from './activeBook';
import { saveAudiobookProgress } from '@/src/api/audiobooks';
import type { AudiobookFileInfo } from '@/src/api/audiobooks';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SAVE_INTERVAL_MS = 10_000;

let activeAudiobookFiles: AudiobookFileInfo[] = [];
let lastSaveAt = 0;
let lastSaved: { fileIndex: number; time: number } | null = null;

export function setActiveAudiobook(
  bookId: string | null,
  files: AudiobookFileInfo[] = [],
): void {
  setActiveBookId(bookId);
  activeAudiobookFiles = files;
  lastSaved = null;
  lastSaveAt = 0;
}

export async function saveCurrentProgress(): Promise<void> {
  const bookId = activeBookId();
  if (!bookId || activeAudiobookFiles.length === 0) return;

  const trackIndex = await TrackPlayer.getActiveTrackIndex();
  if (trackIndex == null) return;

  const { position } = await TrackPlayer.getProgress();
  if (!isFinite(position) || position < 0) return;

  const file = activeAudiobookFiles[trackIndex];
  if (!file) return;

  const fileIndex = file.fileIndex;
  const totalDuration = activeAudiobookFiles.reduce(
    (s, f) => s + f.duration,
    0,
  );

  // Skip if nothing meaningful changed
  if (
    lastSaved &&
    lastSaved.fileIndex === fileIndex &&
    Math.abs(lastSaved.time - position) < 1
  )
    return;

  lastSaved = { fileIndex, time: position };

  await writePendingProgress(bookId, fileIndex, position, totalDuration);
  try {
    await saveAudiobookProgress(bookId, fileIndex, position, totalDuration);
    await AsyncStorage.removeItem(pendingProgressKey(bookId));
  } catch {
    // Stays in AsyncStorage for foreground flush
  }
}

export function registerProgressListener(): void {
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, () => {
    const now = Date.now();
    if (now - lastSaveAt < SAVE_INTERVAL_MS) return;
    lastSaveAt = now;
    void saveCurrentProgress();
  });
}
