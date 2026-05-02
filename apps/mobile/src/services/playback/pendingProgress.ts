import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveAudiobookProgress } from '@/src/api/audiobooks';

interface PendingRecord {
  fileIndex: number;
  time: number;
  totalDuration: number;
}

export function pendingProgressKey(bookId: string): string {
  return `litara-audiobook-progress-pending-${bookId}`;
}

export async function writePendingProgress(
  bookId: string,
  fileIndex: number,
  time: number,
  totalDuration: number,
): Promise<void> {
  await AsyncStorage.setItem(
    pendingProgressKey(bookId),
    JSON.stringify({ fileIndex, time, totalDuration } satisfies PendingRecord),
  );
}

export async function flushPendingProgress(bookId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(pendingProgressKey(bookId));
  if (!raw) return;
  await AsyncStorage.removeItem(pendingProgressKey(bookId));
  try {
    const { fileIndex, time, totalDuration } = JSON.parse(raw) as PendingRecord;
    await saveAudiobookProgress(bookId, fileIndex, time, totalDuration);
  } catch {
    // Restore so the next foreground transition retries
    await AsyncStorage.setItem(pendingProgressKey(bookId), raw);
  }
}
