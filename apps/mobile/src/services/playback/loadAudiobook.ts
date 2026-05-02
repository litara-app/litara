import { File } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TrackPlayer from 'react-native-track-player';
import { buildAudiobookQueue, trackId } from './queue';
import { setActiveAudiobook } from './progressSaver';
import {
  getAudiobookProgress,
  buildLocalFilePath,
  issueStreamToken,
} from '@/src/api/audiobooks';
import type { AudiobookFileInfo } from '@/src/api/audiobooks';

const SPEED_KEY = 'litara-audiobook-speed';

interface LoadAudiobookArgs {
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  audiobookFiles: AudiobookFileInfo[];
}

export async function loadAudiobook(args: LoadAudiobookArgs): Promise<void> {
  const { bookId, bookTitle, bookAuthors, audiobookFiles } = args;
  if (audiobookFiles.length === 0) return;

  // Short-circuit: same audiobook already queued
  const queue = await TrackPlayer.getQueue();
  if (
    queue.length > 0 &&
    queue[0].id === trackId(bookId, audiobookFiles[0].fileIndex)
  ) {
    setActiveAudiobook(bookId, audiobookFiles);
    return;
  }

  // Determine source: local files if all are present on disk
  const allLocal = audiobookFiles.every(
    (f) => new File(buildLocalFilePath(bookId, f.fileIndex, f.mimeType)).exists,
  );

  let streamToken: string | null = null;
  if (!allLocal) {
    const tokenRes = await issueStreamToken();
    streamToken = tokenRes.token;
  }

  const tracks = buildAudiobookQueue(audiobookFiles, {
    bookId,
    bookTitle,
    bookAuthors,
    useLocalFiles: allLocal,
    streamToken,
  });

  // Fetch saved progress and speed in parallel
  const [savedProgress, savedSpeed] = await Promise.all([
    getAudiobookProgress(bookId).catch(() => null),
    AsyncStorage.getItem(SPEED_KEY).catch(() => null),
  ]);

  await TrackPlayer.reset();
  await TrackPlayer.add(tracks);

  const rate = savedSpeed ? parseFloat(savedSpeed) : 1.0;
  await TrackPlayer.setRate(rate);

  let initialIndex = 0;
  let initialSeek = 0;

  if (savedProgress) {
    const idx = audiobookFiles.findIndex(
      (f) => f.fileIndex === savedProgress.currentFileIndex,
    );
    if (idx >= 0) {
      initialIndex = idx;
      initialSeek = savedProgress.currentTime;
    }
  }

  if (initialIndex > 0) {
    await TrackPlayer.skip(initialIndex, initialSeek);
  } else if (initialSeek > 0) {
    await TrackPlayer.seekTo(initialSeek);
  }

  setActiveAudiobook(bookId, audiobookFiles);
}
