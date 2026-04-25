import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from 'expo-audio';
import { getBookDetail } from '@/src/api/books';
import {
  buildStreamUrl,
  getAudiobookProgress,
  issueStreamToken,
  saveAudiobookProgress,
} from '@/src/api/audiobooks';
import type { AudiobookFileInfo } from '@/src/api/audiobooks';
import { serverUrlStore } from '@/src/auth/serverUrlStore';

const SPEEDS = [0.5, 1.0, 1.5, 2.0];
const SPEED_KEY = 'litara-audiobook-speed';
const SAVE_INTERVAL_MS = 10_000;

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

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
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

  const [streamToken, setStreamToken] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [showChapters, setShowChapters] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [activeChapterIdx, setActiveChapterIdx] = useState(-1);

  const chaptersListRef = useRef<FlatList<ChapterWithAbs>>(null);
  const saveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedRef = useRef<{ fileIndex: number; time: number } | null>(null);
  // Tracks a seek position to apply once the new source finishes loading
  const pendingSeekRef = useRef<number | null>(null);
  const wasLoadedRef = useRef(false);
  // Prevents re-entrant auto-advance when a file finishes
  const advancingRef = useRef(false);
  // Freeze slider position while the user is dragging
  const isSlidingRef = useRef(false);

  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);

  const { data: book, isLoading: bookLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => getBookDetail(bookId),
  });

  const audiobookFiles = book?.audiobookFiles ?? [];

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

  const currentTime = status.currentTime ?? 0;
  const absoluteCurrentTime =
    (fileStartOffsets[currentFileIndex] ?? 0) + currentTime;

  // ---------------------------------------------------------------------------
  // Audio mode (background/silent-mode playback)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    }).catch(console.error);
  }, []);

  // ---------------------------------------------------------------------------
  // Restore speed preference
  // ---------------------------------------------------------------------------

  useEffect(() => {
    AsyncStorage.getItem(SPEED_KEY).then((val) => {
      if (val) setSpeed(parseFloat(val));
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Stream token
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!book?.hasAudiobook) return;
    issueStreamToken()
      .then((res) => setStreamToken(res.token))
      .catch(console.error);
  }, [book]);

  // ---------------------------------------------------------------------------
  // Seek-after-replace: fire once the new source becomes loaded
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const nowLoaded = status.isLoaded;
    if (!wasLoadedRef.current && nowLoaded && pendingSeekRef.current !== null) {
      player.seekTo(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
    wasLoadedRef.current = nowLoaded;
  }, [status.isLoaded, player]);

  // ---------------------------------------------------------------------------
  // Load a file into the player; optionally seek after it's ready
  // ---------------------------------------------------------------------------

  const loadFile = useCallback(
    (fileIndex: number, seekTo = 0) => {
      const file = audiobookFiles.find(
        (f: AudiobookFileInfo) => f.fileIndex === fileIndex,
      );
      if (!file || !streamToken) return;
      const url = buildStreamUrl(bookId, fileIndex, streamToken);
      wasLoadedRef.current = false;
      if (seekTo > 0) pendingSeekRef.current = seekTo;
      player.replace({ uri: url });
      setCurrentFileIndex(fileIndex);
    },
    [audiobookFiles, streamToken, bookId, player],
  );

  // ---------------------------------------------------------------------------
  // Initial load + restore progress
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!streamToken || audiobookFiles.length === 0) return;

    async function init() {
      const [savedProgress, savedSpeed] = await Promise.all([
        getAudiobookProgress(bookId).catch(() => null),
        AsyncStorage.getItem(SPEED_KEY).catch(() => null),
      ]);

      const rate = savedSpeed ? parseFloat(savedSpeed) : 1.0;
      setSpeed(rate);
      player.setPlaybackRate(rate);

      let initialFileIndex = audiobookFiles[0]?.fileIndex ?? 0;
      let initialSeek = 0;

      if (savedProgress) {
        const file = audiobookFiles.find(
          (f: AudiobookFileInfo) =>
            f.fileIndex === savedProgress.currentFileIndex,
        );
        if (file) {
          initialFileIndex = savedProgress.currentFileIndex;
          initialSeek = savedProgress.currentTime;
        }
      }

      loadFile(initialFileIndex, initialSeek);

      player.setActiveForLockScreen(
        true,
        {
          title: book?.title ?? 'Audiobook',
          artist: book?.authors.join(', ') ?? '',
          artworkUrl: buildCoverUrl(bookId),
        },
        { showSeekForward: true, showSeekBackward: true },
      );

      setPlayerReady(true);
    }

    init().catch(console.error);
  }, [streamToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Clear lock screen controls on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      player.clearLockScreenControls();
    };
  }, [player]);

  // ---------------------------------------------------------------------------
  // Auto-advance to next file when playback finishes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!status.didJustFinish || !playerReady || advancingRef.current) return;
    const currentIdx = audiobookFiles.findIndex(
      (f: AudiobookFileInfo) => f.fileIndex === currentFileIndex,
    );
    const nextFile = audiobookFiles[currentIdx + 1];
    if (!nextFile) return;

    advancingRef.current = true;
    loadFile(nextFile.fileIndex, 0);
    // play() once the source loads — handled via wasLoadedRef pattern below
    pendingSeekRef.current = null; // no seek needed, start from 0
    // Brief delay to let the replace settle before playing
    setTimeout(() => {
      player.play();
      advancingRef.current = false;
    }, 400);
  }, [status.didJustFinish]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Track active chapter
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
  // Progress auto-save
  // ---------------------------------------------------------------------------

  const doSave = useCallback(
    async (fileIndex: number, time: number) => {
      if (!isFinite(time) || time < 0) return;
      const last = lastSavedRef.current;
      if (
        last &&
        last.fileIndex === fileIndex &&
        Math.abs(last.time - time) < 1
      )
        return;
      lastSavedRef.current = { fileIndex, time };
      await saveAudiobookProgress(bookId, fileIndex, time, totalDuration).catch(
        console.error,
      );
    },
    [bookId, totalDuration],
  );

  useEffect(() => {
    if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
    if (!playerReady) return;
    saveIntervalRef.current = setInterval(() => {
      if (status.playing) void doSave(currentFileIndex, currentTime);
    }, SAVE_INTERVAL_MS);
    return () => {
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
    };
  }, [status.playing, playerReady, currentFileIndex, currentTime, doSave]);

  useEffect(() => {
    if (!playerReady || status.playing) return;
    void doSave(currentFileIndex, currentTime);
  }, [status.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const togglePlay = useCallback(() => {
    if (status.playing) player.pause();
    else player.play();
  }, [status.playing, player]);

  const seekRelative = useCallback(
    (delta: number) => {
      player.seekTo(Math.max(0, currentTime + delta));
    },
    [currentTime, player],
  );

  const cycleSpeed = useCallback(async () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    player.setPlaybackRate(next);
    await AsyncStorage.setItem(SPEED_KEY, String(next));
  }, [speed, player]);

  const seekToChapter = useCallback(
    (ch: ChapterWithAbs) => {
      if (ch.fileIndex !== currentFileIndex) {
        const wasPlaying = status.playing;
        loadFile(ch.fileIndex, ch.startTime);
        if (wasPlaying) {
          setTimeout(() => player.play(), 400);
        }
      } else {
        player.seekTo(ch.startTime);
      }
    },
    [currentFileIndex, status.playing, loadFile, player],
  );

  const prevChapter = useCallback(() => {
    if (activeChapterIdx <= 0) {
      player.seekTo(0);
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
    player,
  ]);

  const nextChapter = useCallback(() => {
    const next = allChapters[activeChapterIdx + 1];
    if (next) seekToChapter(next);
  }, [activeChapterIdx, allChapters, seekToChapter]);

  const onSlidingComplete = useCallback(
    (value: number) => {
      isSlidingRef.current = false;
      const targetAbs = (value / 100) * totalDuration;
      let targetFileIdx = audiobookFiles[0]?.fileIndex ?? 0;
      let targetOffset = targetAbs;
      for (const f of audiobookFiles) {
        const start = fileStartOffsets[f.fileIndex] ?? 0;
        if (
          targetAbs < start + f.duration ||
          f === audiobookFiles[audiobookFiles.length - 1]
        ) {
          targetFileIdx = f.fileIndex;
          targetOffset = Math.max(0, targetAbs - start);
          break;
        }
      }
      if (targetFileIdx !== currentFileIndex) {
        const wasPlaying = status.playing;
        loadFile(targetFileIdx, targetOffset);
        if (wasPlaying) setTimeout(() => player.play(), 400);
      } else {
        player.seekTo(targetOffset);
      }
    },
    [
      audiobookFiles,
      fileStartOffsets,
      totalDuration,
      currentFileIndex,
      status.playing,
      loadFile,
      player,
    ],
  );

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
          onSlidingStart={() => {
            isSlidingRef.current = true;
          }}
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
            name={status.playing ? 'pause' : 'play'}
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
