import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackPlayer, {
  Event,
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';
import { getBookDetail } from '@/src/api/books';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { buildLocalFilePath } from '@/src/api/audiobooks';
import { useAudiobookDownload } from '@/src/hooks/useAudiobookDownload';
import { ensurePlayerSetup } from '@/src/services/playback/setup';
import { loadAudiobook } from '@/src/services/playback/loadAudiobook';
import { formatTime } from '@/src/utils/formatTime';
import type { AudiobookFileInfo } from '@/src/api/audiobooks';

const SPEEDS = [0.5, 1.0, 1.5, 2.0];
const SPEED_KEY = 'litara-audiobook-speed';

interface ChapterWithAbs {
  index: number;
  title: string;
  startTime: number;
  endTime: number | null;
  fileIndex: number;
  absoluteStart: number;
}

interface Props {
  bookId: string;
}

function buildCoverUrl(bookId: string): string {
  const base = serverUrlStore.get() ?? '';
  return `${base}/api/v1/books/${bookId}/cover`;
}

export function AudiobookPlayerScreen({ bookId }: Props) {
  return <AudiobookPlayerImpl bookId={bookId} />;
}

function AudiobookPlayerImpl({ bookId }: Props) {
  const insets = useSafeAreaInsets();

  const [playerReady, setPlayerReady] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [showChapters, setShowChapters] = useState(false);
  const [activeChapterIdx, setActiveChapterIdx] = useState(-1);
  // Tracks which queue index is currently active (updated via RNTP event)
  const [activeQueueIdx, setActiveQueueIdx] = useState(0);

  const chaptersListRef = useRef<FlatList<ChapterWithAbs>>(null);

  // RNTP reactive state
  const progress = useProgress(500);
  const { state } = usePlaybackState();
  useActiveTrack(); // subscribe so RNTP notifies on track changes

  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], ({ index }) => {
    if (index != null) setActiveQueueIdx(index);
  });

  const isPlaying = state === State.Playing;

  const { data: book, isLoading: bookLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => getBookDetail(bookId),
  });

  const audiobookFiles = useMemo(() => book?.audiobookFiles ?? [], [book]);

  const { downloadStatus, downloadProgress, startDownload, cancelAndDelete } =
    useAudiobookDownload(bookId, audiobookFiles);

  const fileStartOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const f of audiobookFiles) {
      offsets[f.fileIndex] = acc;
      acc += f.duration;
    }
    return offsets;
  }, [audiobookFiles]);

  const totalDuration = useMemo(
    () => audiobookFiles.reduce((sum, f) => sum + f.duration, 0),
    [audiobookFiles],
  );

  const allChapters = useMemo<ChapterWithAbs[]>(() => {
    const chapters: ChapterWithAbs[] = [];
    for (const file of audiobookFiles) {
      const offset = fileStartOffsets[file.fileIndex] ?? 0;
      for (const ch of file.chapters) {
        chapters.push({
          ...ch,
          fileIndex: file.fileIndex,
          absoluteStart: offset + ch.startTime,
        });
      }
    }
    return chapters;
  }, [audiobookFiles, fileStartOffsets]);

  const activeFileIndex = audiobookFiles[activeQueueIdx]?.fileIndex ?? 0;
  const currentTime = progress.position;
  const absoluteCurrentTime =
    (fileStartOffsets[activeFileIndex] ?? 0) + currentTime;

  // ---------------------------------------------------------------------------
  // Restore speed preference for UI display
  // ---------------------------------------------------------------------------

  useEffect(() => {
    AsyncStorage.getItem(SPEED_KEY).then((val) => {
      if (val) setSpeed(parseFloat(val));
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Setup RNTP and load audiobook queue
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!book || audiobookFiles.length === 0) return;

    void (async () => {
      await ensurePlayerSetup();
      await loadAudiobook({
        bookId,
        bookTitle: book.title,
        bookAuthors: book.authors,
        audiobookFiles,
      });
      const idx = await TrackPlayer.getActiveTrackIndex();
      if (idx != null) setActiveQueueIdx(idx);
      setPlayerReady(true);
    })();
  }, [bookId, book]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Track active chapter + auto-scroll
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let best = -1;
    for (let i = 0; i < allChapters.length; i++) {
      if (allChapters[i].absoluteStart <= absoluteCurrentTime + 0.25) best = i;
      else break;
    }
    if (best !== activeChapterIdx) {
      setActiveChapterIdx(best);
      if (best >= 0 && chaptersListRef.current) {
        chaptersListRef.current.scrollToIndex({
          index: best,
          animated: true,
          viewPosition: 0.5,
        });
      }
    }
  }, [absoluteCurrentTime, allChapters, activeChapterIdx]);

  // ---------------------------------------------------------------------------
  // Seek to absolute audiobook position (handles cross-file)
  // ---------------------------------------------------------------------------

  const seekToAbsolutePosition = useCallback(
    async (absTarget: number) => {
      const clamped = Math.max(0, Math.min(totalDuration, absTarget));

      let targetQueueIdx = 0;
      let targetOffset = 0;

      for (let i = 0; i < audiobookFiles.length; i++) {
        const f = audiobookFiles[i];
        const start = fileStartOffsets[f.fileIndex] ?? 0;
        if (clamped < start + f.duration || i === audiobookFiles.length - 1) {
          targetQueueIdx = i;
          targetOffset = Math.max(0, clamped - start);
          break;
        }
      }

      if (targetQueueIdx !== activeQueueIdx) {
        await TrackPlayer.skip(targetQueueIdx, targetOffset);
      } else {
        await TrackPlayer.seekTo(targetOffset);
      }
    },
    [totalDuration, audiobookFiles, fileStartOffsets, activeQueueIdx],
  );

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const togglePlay = useCallback(() => {
    if (isPlaying) void TrackPlayer.pause();
    else void TrackPlayer.play();
  }, [isPlaying]);

  const seekRelative = useCallback(
    (delta: number) => {
      void seekToAbsolutePosition(absoluteCurrentTime + delta);
    },
    [absoluteCurrentTime, seekToAbsolutePosition],
  );

  const cycleSpeed = useCallback(async () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    await TrackPlayer.setRate(next);
    await AsyncStorage.setItem(SPEED_KEY, String(next));
  }, [speed]);

  const seekToChapter = useCallback(
    (ch: ChapterWithAbs) => {
      void seekToAbsolutePosition(ch.absoluteStart);
    },
    [seekToAbsolutePosition],
  );

  const prevChapter = useCallback(() => {
    if (activeChapterIdx <= 0) {
      void seekToAbsolutePosition(0);
      return;
    }
    const ch = allChapters[activeChapterIdx];
    if (ch && absoluteCurrentTime - ch.absoluteStart > 3) seekToChapter(ch);
    else {
      const prev = allChapters[activeChapterIdx - 1];
      if (prev) seekToChapter(prev);
    }
  }, [
    activeChapterIdx,
    allChapters,
    absoluteCurrentTime,
    seekToChapter,
    seekToAbsolutePosition,
  ]);

  const nextChapter = useCallback(() => {
    const next = allChapters[activeChapterIdx + 1];
    if (next) seekToChapter(next);
  }, [activeChapterIdx, allChapters, seekToChapter]);

  const onSlidingComplete = useCallback(
    (value: number) => {
      void seekToAbsolutePosition((value / 100) * totalDuration);
    },
    [seekToAbsolutePosition, totalDuration],
  );

  const openWithExternalPlayer = useCallback(() => {
    if (audiobookFiles.length === 0) return;
    const firstFile = audiobookFiles[0];
    const uri = buildLocalFilePath(
      bookId,
      firstFile.fileIndex,
      firstFile.mimeType,
    );
    Alert.alert(
      'Open with External Player',
      'Your listening position will not sync back when using an external app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            const available = await Sharing.isAvailableAsync();
            if (!available) {
              Alert.alert(
                'Unavailable',
                'File sharing is not supported on this device.',
              );
              return;
            }
            await Sharing.shareAsync(uri, {
              mimeType: firstFile.mimeType,
              dialogTitle: 'Open audiobook with...',
            });
          },
        },
      ],
    );
  }, [audiobookFiles, bookId]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (bookLoading || !book) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!book.hasAudiobook) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.dimText}>
          No audiobook available for this title.
        </Text>
      </View>
    );
  }

  if (!playerReady) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#fff" />
        <Text style={[styles.dimText, { marginTop: 12 }]}>
          Loading audiobook…
        </Text>
      </View>
    );
  }

  const progressPercent =
    totalDuration > 0 ? (absoluteCurrentTime / totalDuration) * 100 : 0;
  const activeChapter = allChapters[activeChapterIdx];

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Image
        source={{ uri: buildCoverUrl(bookId) }}
        style={styles.cover}
        contentFit="contain"
      />

      <Text style={styles.title} numberOfLines={2}>
        {book.title}
      </Text>
      <Text style={styles.author} numberOfLines={1}>
        {book.authors.join(', ')}
      </Text>
      {activeChapter && (
        <Text style={styles.chapter} numberOfLines={1}>
          {activeChapter.title}
        </Text>
      )}

      <View style={styles.seekRow}>
        <Text style={styles.dimText}>{formatTime(absoluteCurrentTime)}</Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={100}
          value={progressPercent}
          onSlidingComplete={onSlidingComplete}
          minimumTrackTintColor="#fff"
          maximumTrackTintColor="#555"
          thumbTintColor="#fff"
        />
        <Text style={styles.dimText}>
          -{formatTime(Math.max(0, totalDuration - absoluteCurrentTime))}
        </Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          onPress={() => seekRelative(-30)}
          style={styles.ctrlBtn}
        >
          <Ionicons
            name="refresh"
            size={26}
            color="#aaa"
            style={{ transform: [{ scaleX: -1 }] }}
          />
          <Text style={styles.seekLabel}>30</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={prevChapter}
          style={styles.ctrlBtn}
          disabled={allChapters.length === 0}
        >
          <Ionicons
            name="play-skip-back"
            size={28}
            color={allChapters.length === 0 ? '#555' : '#fff'}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={34}
            color="#000"
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={nextChapter}
          style={styles.ctrlBtn}
          disabled={activeChapterIdx >= allChapters.length - 1}
        >
          <Ionicons
            name="play-skip-forward"
            size={28}
            color={activeChapterIdx >= allChapters.length - 1 ? '#555' : '#fff'}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => seekRelative(30)}
          style={styles.ctrlBtn}
        >
          <Ionicons name="refresh" size={26} color="#aaa" />
          <Text style={styles.seekLabel}>30</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.secondaryRow}>
        <TouchableOpacity onPress={cycleSpeed} style={styles.speedBtn}>
          <Text style={styles.speedText}>{speed}×</Text>
        </TouchableOpacity>
        {allChapters.length > 0 && (
          <TouchableOpacity
            onPress={() => setShowChapters((v) => !v)}
            style={styles.speedBtn}
          >
            <Ionicons
              name="list"
              size={20}
              color={showChapters ? '#fff' : '#aaa'}
            />
          </TouchableOpacity>
        )}
        {downloadStatus === 'not-downloaded' && (
          <TouchableOpacity onPress={startDownload} style={styles.speedBtn}>
            <Ionicons name="download-outline" size={20} color="#aaa" />
          </TouchableOpacity>
        )}
        {downloadStatus === 'downloading' && downloadProgress && (
          <View style={styles.downloadingRow}>
            <ActivityIndicator size="small" color="#aaa" />
            <Text style={styles.downloadingText}>
              {downloadProgress.currentFile}/{downloadProgress.totalFiles}
            </Text>
          </View>
        )}
        {downloadStatus === 'downloaded' && (
          <TouchableOpacity
            onPress={() => void cancelAndDelete()}
            style={styles.speedBtn}
          >
            <Ionicons name="cloud-done-outline" size={20} color="#4ade80" />
          </TouchableOpacity>
        )}
        {downloadStatus === 'downloaded' && (
          <TouchableOpacity
            onPress={openWithExternalPlayer}
            style={styles.speedBtn}
          >
            <Ionicons name="share-outline" size={20} color="#aaa" />
          </TouchableOpacity>
        )}
      </View>

      {showChapters && allChapters.length > 0 && (
        <FlatList
          ref={chaptersListRef}
          data={allChapters}
          keyExtractor={(ch) => `${ch.fileIndex}-${ch.index}`}
          style={styles.chapterList}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item: ch, index: i }) => (
            <Pressable
              onPress={() => seekToChapter(ch)}
              style={[
                styles.chapterItem,
                i === activeChapterIdx && styles.chapterItemActive,
              ]}
            >
              <Text
                style={[
                  styles.chapterTitle,
                  i === activeChapterIdx && styles.chapterTitleActive,
                ]}
                numberOfLines={1}
              >
                {ch.title}
              </Text>
              <Text style={styles.dimText}>{formatTime(ch.absoluteStart)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  center: { justifyContent: 'center', alignItems: 'center' },
  cover: { width: '100%', height: 220, borderRadius: 8, marginBottom: 16 },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  author: { color: '#aaa', fontSize: 14, textAlign: 'center', marginBottom: 4 },
  chapter: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  seekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  slider: { flex: 1, height: 40 },
  dimText: { color: '#888', fontSize: 12, minWidth: 42, textAlign: 'center' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
  },
  ctrlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
  },
  seekLabel: { color: '#aaa', fontSize: 10, position: 'absolute', bottom: 2 },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 12,
  },
  speedBtn: { padding: 8 },
  speedText: { color: '#aaa', fontSize: 14, fontWeight: '600' },
  downloadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
  },
  downloadingText: { color: '#aaa', fontSize: 12 },
  chapterList: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
  },
  chapterItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e1e',
  },
  chapterItemActive: { backgroundColor: '#1a2a3a' },
  chapterTitle: { color: '#ccc', fontSize: 14, flex: 1, marginRight: 8 },
  chapterTitleActive: { color: '#fff', fontWeight: '600' },
});
