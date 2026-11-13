import type { AddTrack } from 'react-native-track-player';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { buildLocalFilePath, buildStreamUrl } from '@/src/api/audiobooks';
import type { AudiobookFileInfo } from '@/src/api/audiobooks';

interface QueueOpts {
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  useLocalFiles: boolean;
  streamToken: string | null;
}

export function trackId(bookId: string, fileIndex: number): string {
  return `audiobook:${bookId}:${fileIndex}`;
}

export function buildAudiobookQueue(
  audiobookFiles: AudiobookFileInfo[],
  opts: QueueOpts,
): AddTrack[] {
  const { bookId, bookTitle, bookAuthors, useLocalFiles, streamToken } = opts;
  const base = serverUrlStore.get() ?? '';
  const artwork = `${base}/api/v1/books/${bookId}/cover`;
  const artist = bookAuthors.join(', ');

  return [...audiobookFiles]
    .sort((a, b) => a.fileIndex - b.fileIndex)
    .map((f) => ({
      id: trackId(bookId, f.fileIndex),
      url:
        useLocalFiles || !streamToken
          ? buildLocalFilePath(bookId, f.fileIndex, f.mimeType)
          : buildStreamUrl(bookId, f.fileIndex, streamToken),
      title: bookTitle,
      artist,
      artwork,
      duration: f.duration,
    }));
}
