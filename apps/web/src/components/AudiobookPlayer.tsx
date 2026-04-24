import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Box,
  Group,
  ActionIcon,
  Text,
  Slider,
  Stack,
  ScrollArea,
  Button,
  Tooltip,
  Paper,
  TextInput,
  UnstyledButton,
  Portal,
} from '@mantine/core';
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconList,
  IconRewindBackward60,
  IconRewindForward60,
  IconVolume,
  IconVolumeOff,
  IconBookmark,
  IconCheck,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { api } from '../utils/api';
import { audiobookPlayerAtom } from '../store/atoms';

export const PLAYER_HEIGHT = 88;

interface AudiobookBookmark {
  id: string;
  timeSeconds: number;
  note: string;
  createdAt: string;
}

interface ChapterWithAbs {
  fileIndex: number;
  index: number;
  title: string;
  startTime: number;
  endTime: number | null;
  absoluteStart: number;
}

interface PendingSeek {
  time: number;
  shouldPlay: boolean;
}

const SPEEDS = [0.5, 1.0, 1.5, 2.0];
const PROGRESS_SAVE_INTERVAL_MS = 10_000;
const SPEED_STORAGE_KEY = 'litara-audiobook-speed';
const VOLUME_STORAGE_KEY = 'litara-audiobook-volume';

const log = (...args: unknown[]) => console.log('[AudiobookPlayer]', ...args);

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PersistentAudiobookPlayer() {
  const playerState = useAtomValue(audiobookPlayerAtom);
  const setPlayerState = useSetAtom(audiobookPlayerAtom);

  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeekRef = useRef<PendingSeek | null>(null);
  const initialProgressAppliedRef = useRef(false);
  const lastSavedRef = useRef<{ fileIndex: number; time: number } | null>(null);
  const lastSeekTargetRef = useRef<{ time: number; at: number } | null>(null);
  const prevVolumeRef = useRef(1);

  const {
    bookId,
    bookTitle,
    hasCover,
    narrator,
    audiobookFiles,
    initialProgress,
  } = playerState ?? {
    bookId: '',
    bookTitle: '',
    hasCover: false,
    narrator: null,
    audiobookFiles: [],
    initialProgress: null,
  };

  const initialFileIndex = initialProgress?.currentFileIndex ?? 0;
  const initialTime = initialProgress?.currentTime ?? 0;

  const [currentFileIndex, setCurrentFileIndex] = useState(initialFileIndex);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [showChapters, setShowChapters] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [streamToken, setStreamToken] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(() => {
    const saved = localStorage.getItem(SPEED_STORAGE_KEY);
    return saved ? parseFloat(saved) : 1.0;
  });
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem(VOLUME_STORAGE_KEY);
    return saved ? parseFloat(saved) : 1.0;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState('');
  const [bookmarks, setBookmarks] = useState<AudiobookBookmark[]>([]);

  const currentFile = useMemo(
    () =>
      audiobookFiles.find((f) => f.fileIndex === currentFileIndex) ??
      audiobookFiles[0],
    [audiobookFiles, currentFileIndex],
  );

  const totalDuration = useMemo(
    () => audiobookFiles.reduce((sum, f) => sum + f.duration, 0),
    [audiobookFiles],
  );

  const fileStartOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const f of audiobookFiles) {
      offsets[f.fileIndex] = acc;
      acc += f.duration;
    }
    return offsets;
  }, [audiobookFiles]);

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

  const absoluteCurrentTime =
    (fileStartOffsets[currentFileIndex] ?? 0) + currentTime;

  const activeChapterIndex = useMemo(() => {
    let best = -1;
    for (let i = 0; i < allChapters.length; i++) {
      if (allChapters[i].absoluteStart <= absoluteCurrentTime + 0.25) best = i;
      else break;
    }
    return best;
  }, [allChapters, absoluteCurrentTime]);

  // ---------------------------------------------------------------------------
  // Stream token
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    api
      .post<{ token: string }>('/audiobooks/stream-token')
      .then((res) => {
        if (!cancelled) setStreamToken(res.data.token);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const streamUrl = useMemo(() => {
    if (!currentFile || !streamToken || !bookId) return '';
    const base = api.defaults.baseURL ?? '/api/v1';
    return `${base}/audiobooks/${bookId}/files/${currentFile.fileIndex}/stream?streamToken=${encodeURIComponent(streamToken)}`;
  }, [bookId, currentFile, streamToken]);

  // ---------------------------------------------------------------------------
  // Audio source management
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    log(`loading fileIndex=${currentFileIndex}`);
    audio.src = streamUrl;
    audio.load();
    audio.playbackRate = speed;
  }, [streamUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;

    let target = 0;
    let shouldPlay = false;

    if (pendingSeekRef.current) {
      target = pendingSeekRef.current.time;
      shouldPlay = pendingSeekRef.current.shouldPlay;
      pendingSeekRef.current = null;
    } else if (!initialProgressAppliedRef.current) {
      initialProgressAppliedRef.current = true;
      if (
        initialProgress &&
        initialProgress.currentFileIndex === currentFileIndex
      ) {
        target = initialProgress.currentTime;
      }
    }

    const clamped = isFinite(audio.duration)
      ? Math.max(0, Math.min(audio.duration - 0.1, target))
      : target;

    if (clamped > 0) {
      lastSeekTargetRef.current = { time: clamped, at: Date.now() };
      audio.currentTime = clamped;
      setCurrentTime(clamped);
    }

    audio.playbackRate = speed;
    if (shouldPlay) void audio.play().catch((e) => log('play() rejected:', e));
  };

  // Apply speed and volume changes live
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
    localStorage.setItem(SPEED_STORAGE_KEY, String(speed));
  }, [speed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = isMuted ? 0 : volume;
    if (!isMuted && volume > 0) {
      prevVolumeRef.current = volume;
      localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    }
  }, [volume, isMuted]);

  // ---------------------------------------------------------------------------
  // Bookmarks
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!bookId) return;
    void api
      .get<AudiobookBookmark[]>(`/audiobooks/${bookId}/bookmarks`)
      .then((res) => {
        setBookmarks(res.data);
      })
      .catch(() => {});
  }, [bookId]);

  const saveBookmark = useCallback(async () => {
    if (!bookId) return;
    try {
      const res = await api.post<AudiobookBookmark>(
        `/audiobooks/${bookId}/bookmarks`,
        {
          timeSeconds: absoluteCurrentTime,
          note: bookmarkNote.trim(),
        },
      );
      setBookmarks((prev) =>
        [...prev, res.data].sort((a, b) => a.timeSeconds - b.timeSeconds),
      );
      setBookmarkNote('');
    } catch {
      // ignore
    }
  }, [bookId, absoluteCurrentTime, bookmarkNote]);

  const deleteBookmark = useCallback(
    async (bookmarkId: string) => {
      if (!bookId) return;
      try {
        await api.delete(`/audiobooks/${bookId}/bookmarks/${bookmarkId}`);
        setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
      } catch {
        // ignore
      }
    },
    [bookId],
  );

  // ---------------------------------------------------------------------------
  // Audio event handlers
  // ---------------------------------------------------------------------------

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (pendingSeekRef.current !== null) return;
    if (audio.readyState < 1) return;

    const seekTarget = lastSeekTargetRef.current;
    if (seekTarget) {
      const age = Date.now() - seekTarget.at;
      if (age > 2000) {
        lastSeekTargetRef.current = null;
      } else if (Math.abs(audio.currentTime - seekTarget.time) > 2) {
        return;
      } else {
        lastSeekTargetRef.current = null;
      }
    }

    setCurrentTime(audio.currentTime);
  };

  const handleSeeking = () =>
    log(`seeking: currentTime=${audioRef.current?.currentTime}`);

  const handleSeeked = () => {
    const audio = audioRef.current;
    if (!audio) return;
    lastSeekTargetRef.current = null;
    if (pendingSeekRef.current === null && audio.readyState >= 1) {
      setCurrentTime(audio.currentTime);
    }
  };

  const handlePlay = () => setIsPlaying(true);

  const handlePause = () => {
    if (pendingSeekRef.current !== null) return;
    setIsPlaying(false);
    const audio = audioRef.current;
    if (audio && audio.readyState >= 1)
      saveProgress(currentFileIndex, audio.currentTime);
  };

  const handleEnded = () => {
    if (currentFileIndex < audiobookFiles.length - 1) {
      pendingSeekRef.current = { time: 0, shouldPlay: true };
      setCurrentFileIndex((i) => i + 1);
    } else {
      setIsPlaying(false);
      saveProgress(currentFileIndex, currentFile?.duration ?? 0);
    }
  };

  // ---------------------------------------------------------------------------
  // Seek helpers
  // ---------------------------------------------------------------------------

  const saveProgress = useCallback(
    (fileIndex: number, time: number) => {
      if (!bookId || !isFinite(time) || time < 0) return;
      const last = lastSavedRef.current;
      if (
        last &&
        last.fileIndex === fileIndex &&
        Math.abs(last.time - time) < 1
      )
        return;
      lastSavedRef.current = { fileIndex, time };
      void api.put(`/audiobooks/${bookId}/progress`, {
        currentFileIndex: fileIndex,
        currentTime: time,
        totalDuration,
      });
    },
    [bookId, totalDuration],
  );

  const seekToAbsolute = useCallback(
    (absoluteTime: number, opts?: { play?: boolean }) => {
      const clamped = Math.max(0, Math.min(totalDuration - 0.1, absoluteTime));

      let targetFileIndex = audiobookFiles[0]?.fileIndex ?? 0;
      let targetOffset = clamped;
      for (const f of audiobookFiles) {
        const start = fileStartOffsets[f.fileIndex] ?? 0;
        const end = start + f.duration;
        if (clamped < end || f === audiobookFiles[audiobookFiles.length - 1]) {
          targetFileIndex = f.fileIndex;
          targetOffset = Math.max(0, clamped - start);
          break;
        }
      }

      const audio = audioRef.current;
      const shouldPlay = opts?.play ?? isPlaying;

      if (targetFileIndex === currentFileIndex && audio) {
        if (audio.readyState < 1 || !isFinite(audio.duration)) {
          pendingSeekRef.current = { time: targetOffset, shouldPlay };
          setCurrentTime(targetOffset);
          return;
        }
        lastSeekTargetRef.current = { time: targetOffset, at: Date.now() };
        audio.currentTime = targetOffset;
        setCurrentTime(targetOffset);
        if (shouldPlay && audio.paused)
          void audio.play().catch((e) => log('play() rejected:', e));
        saveProgress(targetFileIndex, targetOffset);
      } else {
        pendingSeekRef.current = { time: targetOffset, shouldPlay };
        setCurrentFileIndex(targetFileIndex);
        setCurrentTime(targetOffset);
      }
    },
    [
      audiobookFiles,
      currentFileIndex,
      fileStartOffsets,
      isPlaying,
      totalDuration,
      saveProgress,
    ],
  );

  const seekRelative = useCallback(
    (delta: number) => seekToAbsolute(absoluteCurrentTime + delta),
    [absoluteCurrentTime, seekToAbsolute],
  );

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused)
      void audio.play().catch((e) => log('play() rejected:', e));
    else audio.pause();
  }, []);

  const cycleSpeed = () => {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev);
      return SPEEDS[(idx + 1) % SPEEDS.length];
    });
  };

  const seekToChapter = useCallback(
    (ch: ChapterWithAbs) => seekToAbsolute(ch.absoluteStart),
    [seekToAbsolute],
  );

  const prevChapter = useCallback(() => {
    if (activeChapterIndex <= 0) {
      seekToAbsolute(0);
      return;
    }
    const ch = allChapters[activeChapterIndex];
    if (ch && absoluteCurrentTime - ch.absoluteStart > 3) {
      seekToAbsolute(ch.absoluteStart);
    } else {
      const prev = allChapters[activeChapterIndex - 1];
      if (prev) seekToAbsolute(prev.absoluteStart);
    }
  }, [absoluteCurrentTime, activeChapterIndex, allChapters, seekToAbsolute]);

  const nextChapter = useCallback(() => {
    const next = allChapters[activeChapterIndex + 1];
    if (next) seekToAbsolute(next.absoluteStart);
  }, [activeChapterIndex, allChapters, seekToAbsolute]);

  const handleVolumeIconClick = () => {
    if (isMuted) {
      setIsMuted(false);
      if (volume === 0) setVolume(prevVolumeRef.current || 1);
    } else {
      prevVolumeRef.current = volume;
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    if (isMuted && v > 0) setIsMuted(false);
  };

  const closePlayer = () => {
    const audio = audioRef.current;
    if (audio) {
      if (audio.readyState >= 1 && isFinite(audio.currentTime)) {
        saveProgress(currentFileIndex, audio.currentTime);
      }
      audio.pause();
      audio.src = '';
    }
    setPlayerState(null);
  };

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' && !e.shiftKey) {
        e.preventDefault();
        seekRelative(-10);
      } else if (e.code === 'ArrowRight' && !e.shiftKey) {
        e.preventDefault();
        seekRelative(10);
      } else if (e.code === 'ArrowLeft' && e.shiftKey) {
        e.preventDefault();
        prevChapter();
      } else if (e.code === 'ArrowRight' && e.shiftKey) {
        e.preventDefault();
        nextChapter();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, seekRelative, prevChapter, nextChapter]);

  // ---------------------------------------------------------------------------
  // Progress auto-save
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const id = setInterval(() => {
      const audio = audioRef.current;
      if (isPlaying && audio && audio.readyState >= 1)
        saveProgress(currentFileIndex, audio.currentTime);
    }, PROGRESS_SAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying, currentFileIndex, saveProgress]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio && audio.readyState >= 1 && isFinite(audio.currentTime)) {
        saveProgress(currentFileIndex, audio.currentTime);
      }
    };
  }, [currentFileIndex, saveProgress]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!playerState) return null;

  const progressPercent =
    totalDuration > 0 ? (absoluteCurrentTime / totalDuration) * 100 : 0;
  const sliderValue = dragValue ?? progressPercent;
  const sliderLabel = formatTime((sliderValue / 100) * totalDuration);
  const remaining = Math.max(0, totalDuration - absoluteCurrentTime);
  const currentChapterTitle = allChapters[activeChapterIndex]?.title;
  const effectiveVolume = isMuted ? 0 : volume;

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: PLAYER_HEIGHT + 8,
    right: 16,
    width: 300,
    maxHeight: 400,
    zIndex: 310,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeking={handleSeeking}
        onSeeked={handleSeeked}
        onError={() => {
          const err = audioRef.current?.error;
          log('audio error:', err?.code, err?.message);
        }}
        onStalled={() => log('audio stalled')}
        onWaiting={() => log('audio waiting')}
        preload="metadata"
        style={{ display: 'none' }}
      />

      {/* Chapter list panel */}
      {showChapters && allChapters.length > 0 && (
        <Portal>
          <Paper withBorder shadow="md" style={panelStyle}>
            <Group
              px="sm"
              py="xs"
              justify="space-between"
              style={{
                borderBottom: '1px solid var(--mantine-color-default-border)',
                flexShrink: 0,
              }}
            >
              <Text size="sm" fw={600}>
                Chapters
              </Text>
              <ActionIcon
                size="xs"
                variant="subtle"
                onClick={() => setShowChapters(false)}
              >
                <IconX size={12} />
              </ActionIcon>
            </Group>
            <ScrollArea style={{ flex: 1 }}>
              <Stack gap={0}>
                {allChapters.map((ch, i) => (
                  <Box
                    key={`${ch.fileIndex}-${ch.index}`}
                    onClick={() => seekToChapter(ch)}
                    style={{
                      padding: '6px 12px',
                      cursor: 'pointer',
                      background:
                        i === activeChapterIndex
                          ? 'var(--mantine-color-blue-light)'
                          : undefined,
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Text
                        size="sm"
                        fw={i === activeChapterIndex ? 600 : undefined}
                        truncate
                      >
                        {ch.title}
                      </Text>
                      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                        {formatTime(ch.absoluteStart)}
                      </Text>
                    </Group>
                  </Box>
                ))}
              </Stack>
            </ScrollArea>
          </Paper>
        </Portal>
      )}

      {/* Bookmarks panel */}
      {showBookmarks && (
        <Portal>
          <Paper withBorder shadow="md" style={panelStyle}>
            <Group
              px="sm"
              py="xs"
              justify="space-between"
              style={{
                borderBottom: '1px solid var(--mantine-color-default-border)',
                flexShrink: 0,
              }}
            >
              <Text size="sm" fw={600}>
                Bookmarks
              </Text>
              <ActionIcon
                size="xs"
                variant="subtle"
                onClick={() => setShowBookmarks(false)}
              >
                <IconX size={12} />
              </ActionIcon>
            </Group>
            <Box
              px="sm"
              py="xs"
              style={{
                borderBottom: '1px solid var(--mantine-color-default-border)',
                flexShrink: 0,
              }}
            >
              <Group gap="xs" wrap="nowrap">
                <Text size="xs" c="blue" fw={500} style={{ flexShrink: 0 }}>
                  {formatTime(absoluteCurrentTime)}
                </Text>
                <TextInput
                  size="xs"
                  placeholder="Add note..."
                  value={bookmarkNote}
                  onChange={(e) => setBookmarkNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveBookmark();
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  size="sm"
                  variant="filled"
                  onClick={() => void saveBookmark()}
                >
                  <IconCheck size={14} />
                </ActionIcon>
              </Group>
            </Box>
            <ScrollArea style={{ flex: 1 }}>
              {bookmarks.length === 0 ? (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  No bookmarks yet
                </Text>
              ) : (
                <Stack gap={0}>
                  {bookmarks.map((bm) => (
                    <Group
                      key={bm.id}
                      px="sm"
                      py={6}
                      justify="space-between"
                      wrap="nowrap"
                    >
                      <UnstyledButton
                        onClick={() => seekToAbsolute(bm.timeSeconds)}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <Group gap="xs" wrap="nowrap">
                          <Text
                            size="xs"
                            c="blue"
                            fw={500}
                            style={{ flexShrink: 0, width: 44 }}
                          >
                            {formatTime(bm.timeSeconds)}
                          </Text>
                          <Text size="sm" truncate>
                            {bm.note || '(bookmark)'}
                          </Text>
                        </Group>
                      </UnstyledButton>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="red"
                        style={{ flexShrink: 0 }}
                        onClick={() => void deleteBookmark(bm.id)}
                      >
                        <IconTrash size={12} />
                      </ActionIcon>
                    </Group>
                  ))}
                </Stack>
              )}
            </ScrollArea>
          </Paper>
        </Portal>
      )}

      {/* Main player bar */}
      <Box
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'stretch',
          borderTop: '1px solid var(--mantine-color-default-border)',
          background: 'var(--mantine-color-body)',
        }}
      >
        {/* Left: Now playing info */}
        <Group
          gap="sm"
          px="md"
          style={{
            width: 260,
            flexShrink: 0,
            overflow: 'hidden',
            alignItems: 'center',
          }}
        >
          {hasCover && (
            <img
              src={`/api/v1/books/${bookId}/cover`}
              alt=""
              style={{
                width: 56,
                height: 56,
                objectFit: 'cover',
                borderRadius: 4,
                flexShrink: 0,
              }}
            />
          )}
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>
              {bookTitle}
            </Text>
            {narrator && (
              <Text size="xs" c="dimmed" truncate>
                {narrator}
              </Text>
            )}
            {currentChapterTitle && (
              <Text size="xs" c="dimmed" truncate>
                {currentChapterTitle}
              </Text>
            )}
          </Box>
        </Group>

        {/* Center: Controls + progress bar */}
        <Stack
          gap={6}
          style={{ flex: 1, justifyContent: 'center', padding: '10px 24px' }}
        >
          <Group justify="center" gap={4}>
            <Tooltip label="Previous chapter (Shift+←)">
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={prevChapter}
                disabled={allChapters.length === 0}
              >
                <IconPlayerSkipBack size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Back 1 minute">
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => seekRelative(-60)}
              >
                <IconRewindBackward60 size={16} />
              </ActionIcon>
            </Tooltip>
            <ActionIcon
              variant="filled"
              size="md"
              radius="xl"
              onClick={togglePlay}
            >
              {isPlaying ? (
                <IconPlayerPause size={18} />
              ) : (
                <IconPlayerPlay size={18} />
              )}
            </ActionIcon>
            <Tooltip label="Forward 1 minute">
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => seekRelative(60)}
              >
                <IconRewindForward60 size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Next chapter (Shift+→)">
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={nextChapter}
                disabled={activeChapterIndex >= allChapters.length - 1}
              >
                <IconPlayerSkipForward size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <Group gap={8} align="center" wrap="nowrap">
            <Text
              size="xs"
              c="dimmed"
              style={{ flexShrink: 0, width: 42, textAlign: 'right' }}
            >
              {formatTime(absoluteCurrentTime)}
            </Text>
            <Slider
              value={sliderValue}
              min={0}
              max={100}
              step={0.01}
              label={sliderLabel}
              size="xs"
              style={{ flex: 1 }}
              onChange={(v) => setDragValue(v)}
              onChangeEnd={(v) => {
                setDragValue(null);
                seekToAbsolute((v / 100) * totalDuration);
              }}
              styles={{ thumb: { width: 10, height: 10 } }}
            />
            <Text size="xs" c="dimmed" style={{ flexShrink: 0, width: 50 }}>
              -{formatTime(remaining)}
            </Text>
          </Group>
        </Stack>

        {/* Right: Volume + actions */}
        <Group gap={6} px="md" style={{ flexShrink: 0, alignItems: 'center' }}>
          <Tooltip label={isMuted ? 'Unmute' : 'Mute'}>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={handleVolumeIconClick}
            >
              {isMuted || volume === 0 ? (
                <IconVolumeOff size={16} />
              ) : (
                <IconVolume size={16} />
              )}
            </ActionIcon>
          </Tooltip>
          <Slider
            value={effectiveVolume}
            min={0}
            max={1}
            step={0.01}
            size="xs"
            style={{ width: 72 }}
            onChange={handleVolumeChange}
            label={null}
          />
          <Tooltip label="Playback speed">
            <Button
              variant="subtle"
              size="xs"
              onClick={cycleSpeed}
              style={{ minWidth: 44, padding: '0 6px' }}
            >
              {speed}×
            </Button>
          </Tooltip>
          <Tooltip label="Bookmarks">
            <ActionIcon
              variant={showBookmarks ? 'light' : 'subtle'}
              size="sm"
              onClick={() => {
                setShowBookmarks((v) => !v);
                setShowChapters(false);
              }}
            >
              <IconBookmark size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Chapters">
            <ActionIcon
              variant={showChapters ? 'light' : 'subtle'}
              size="sm"
              disabled={allChapters.length === 0}
              onClick={() => {
                setShowChapters((v) => !v);
                setShowBookmarks(false);
              }}
            >
              <IconList size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Close player">
            <ActionIcon
              variant="subtle"
              size="sm"
              color="red"
              onClick={closePlayer}
            >
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>
    </>
  );
}
