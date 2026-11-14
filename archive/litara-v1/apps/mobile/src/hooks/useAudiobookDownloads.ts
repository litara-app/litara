import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory } from 'expo-file-system';
import { getBookDetail } from '@/src/api/books';
import {
  buildLocalAudiobookDir,
  buildLocalFilePath,
} from '@/src/api/audiobooks';

interface DownloadedBook {
  bookId: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  totalSizeBytes: number;
}

interface UseAudiobookDownloadsResult {
  downloads: DownloadedBook[];
  isLoading: boolean;
  deleteDownload: (bookId: string) => Promise<void>;
  refresh: () => void;
}

const DL_KEY_PREFIX = 'litara-audiobook-dl-';

function isTopLevelKey(key: string): boolean {
  // Top-level key: "litara-audiobook-dl-<bookId>" with no "-file-" segment
  return key.startsWith(DL_KEY_PREFIX) && !key.includes('-file-');
}

function getTotalSizeBytes(
  bookId: string,
  files: { fileIndex: number; mimeType: string; fileSize: number }[],
): number {
  let total = 0;
  for (const f of files) {
    try {
      const file = new File(
        buildLocalFilePath(bookId, f.fileIndex, f.mimeType),
      );
      total += file.exists ? file.size : f.fileSize;
    } catch {
      total += f.fileSize;
    }
  }
  return total;
}

export function useAudiobookDownloads(): UseAudiobookDownloadsResult {
  const [downloads, setDownloads] = useState<DownloadedBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;

    async function load() {
      setIsLoading(true);
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const downloadedBookIds: string[] = [];

        for (const key of allKeys) {
          if (!isTopLevelKey(key)) continue;
          const val = await AsyncStorage.getItem(key);
          if (val === 'downloaded') {
            downloadedBookIds.push(key.slice(DL_KEY_PREFIX.length));
          }
        }

        const results: DownloadedBook[] = [];
        await Promise.all(
          downloadedBookIds.map(async (bookId) => {
            try {
              const book = await getBookDetail(bookId);
              const files = (book.audiobookFiles ?? []).map((f) => ({
                fileIndex: f.fileIndex,
                mimeType: f.mimeType,
                fileSize: f.fileSize ?? 0,
              }));
              const totalSizeBytes = getTotalSizeBytes(bookId, files);
              results.push({
                bookId,
                title: book.title,
                authors: book.authors ?? [],
                hasCover: book.hasCover ?? false,
                totalSizeBytes,
              });
            } catch {
              // Book may have been deleted from the server; skip it
            }
          }),
        );

        results.sort((a, b) => a.title.localeCompare(b.title));

        if (active) setDownloads(results);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [tick]);

  const deleteDownload = useCallback(async (bookId: string) => {
    // Remove top-level status key and all per-file keys
    const allKeys = await AsyncStorage.getAllKeys();
    const toRemove = allKeys.filter(
      (k) =>
        k === `${DL_KEY_PREFIX}${bookId}` ||
        k.startsWith(`${DL_KEY_PREFIX}${bookId}-file-`),
    );
    await AsyncStorage.multiRemove(toRemove);

    // Delete the directory
    const dir = new Directory(buildLocalAudiobookDir(bookId));
    if (dir.exists) {
      dir.delete();
    }

    setDownloads((prev) => prev.filter((d) => d.bookId !== bookId));
  }, []);

  return { downloads, isLoading, deleteDownload, refresh };
}
