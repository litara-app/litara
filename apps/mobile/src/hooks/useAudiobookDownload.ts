import { useCallback, useEffect, useRef, useState } from 'react';
import { File, Directory } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildLocalAudiobookDir,
  buildLocalFilePath,
  downloadAudiobookFile,
} from '@/src/api/audiobooks';
import type { AudiobookFileInfo } from '@/src/api/audiobooks';

type DownloadStatus = 'not-downloaded' | 'downloading' | 'downloaded';

interface DownloadProgress {
  currentFile: number;
  totalFiles: number;
  filePct: number;
}

interface UseAudiobookDownloadResult {
  downloadStatus: DownloadStatus;
  downloadProgress: DownloadProgress | null;
  startDownload: () => void;
  cancelAndDelete: () => Promise<void>;
}

function statusKey(bookId: string): string {
  return `litara-audiobook-dl-${bookId}`;
}

function fileKey(bookId: string, fileIndex: number): string {
  return `litara-audiobook-dl-${bookId}-file-${fileIndex}`;
}

export function useAudiobookDownload(
  bookId: string,
  files: AudiobookFileInfo[],
): UseAudiobookDownloadResult {
  const [downloadStatus, setDownloadStatus] =
    useState<DownloadStatus>('not-downloaded');
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const cancelledRef = useRef(false);

  // On mount, restore status from AsyncStorage and check for interrupted download
  useEffect(() => {
    let active = true;
    async function restore() {
      const stored = await AsyncStorage.getItem(statusKey(bookId));
      if (!active) return;
      if (stored === 'downloaded') {
        setDownloadStatus('downloaded');
      } else if (stored === 'downloading') {
        // Was interrupted — resume automatically
        setDownloadStatus('downloading');
        void runDownload();
      }
    }
    void restore();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const runDownload = useCallback(async () => {
    if (files.length === 0) return;
    cancelledRef.current = false;
    await AsyncStorage.setItem(statusKey(bookId), 'downloading');
    setDownloadStatus('downloading');

    for (let i = 0; i < files.length; i++) {
      if (cancelledRef.current) return;

      const file = files[i];
      const fk = fileKey(bookId, file.fileIndex);
      const alreadyDone = await AsyncStorage.getItem(fk);

      // Check if file already exists on disk
      if (alreadyDone === 'done') {
        const localFile = new File(
          buildLocalFilePath(bookId, file.fileIndex, file.mimeType),
        );
        if (localFile.exists) {
          setDownloadProgress({
            currentFile: i + 1,
            totalFiles: files.length,
            filePct: 100,
          });
          continue;
        }
      }

      setDownloadProgress({
        currentFile: i + 1,
        totalFiles: files.length,
        filePct: 0,
      });

      try {
        await downloadAudiobookFile(bookId, file.fileIndex, file.mimeType);
        await AsyncStorage.setItem(fk, 'done');
        setDownloadProgress({
          currentFile: i + 1,
          totalFiles: files.length,
          filePct: 100,
        });
      } catch {
        if (!cancelledRef.current) {
          // Leave status as 'downloading' so next mount resumes
          return;
        }
        return;
      }
    }

    if (!cancelledRef.current) {
      await AsyncStorage.setItem(statusKey(bookId), 'downloaded');
      setDownloadStatus('downloaded');
      setDownloadProgress(null);
    }
  }, [bookId, files]);

  const startDownload = useCallback(() => {
    void runDownload();
  }, [runDownload]);

  const cancelAndDelete = useCallback(async () => {
    cancelledRef.current = true;
    setDownloadStatus('not-downloaded');
    setDownloadProgress(null);

    // Remove per-file keys
    for (const file of files) {
      await AsyncStorage.removeItem(fileKey(bookId, file.fileIndex));
    }
    await AsyncStorage.removeItem(statusKey(bookId));

    // Delete directory
    const dir = new Directory(buildLocalAudiobookDir(bookId));
    if (dir.exists) {
      dir.delete();
    }
  }, [bookId, files]);

  return { downloadStatus, downloadProgress, startDownload, cancelAndDelete };
}
