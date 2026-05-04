import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Box,
  Group,
  ActionIcon,
  Text,
  Slider,
  Tooltip,
  Button,
} from '@mantine/core';
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconRewindBackward60,
  IconRewindForward60,
  IconVolume,
  IconVolumeOff,
  IconX,
  IconMicrophone,
} from '@tabler/icons-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { api } from '../utils/api';
import { podcastPlayerAtom } from '../store/atoms';

export const PODCAST_PLAYER_HEIGHT = 88;

const SPEEDS = [0.5, 1.0, 1.5, 2.0];
const SPEED_KEY = 'litara-podcast-speed';

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function PersistentPodcastPlayer() {
  const playerState = useAtomValue(podcastPlayerAtom);
  const setPlayerState = useSetAtom(podcastPlayerAtom);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [streamToken, setStreamToken] = useState<string | null>(null);
  const lastSaveRef = useRef(0);
  const restoredRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState<number>(() => {
    const s = localStorage.getItem(SPEED_KEY);
    return s ? parseFloat(s) : 1.0;
  });

  const { episodeId, episodeTitle, podcastTitle, artworkUrl } = playerState ?? {
    episodeId: '',
    episodeTitle: '',
    podcastTitle: '',
    artworkUrl: null,
  };

  // Fetch stream token when episode changes
  useEffect(() => {
    if (!episodeId) return;
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
  }, [episodeId]);

  // Load audio when token is ready
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamToken || !episodeId) return;
    restoredRef.current = false;
    const base = api.defaults.baseURL ?? '/api/v1';
    audio.src = `${base}/podcasts/episodes/${episodeId}/stream?streamToken=${encodeURIComponent(streamToken)}`;
    audio.load();
    audio.playbackRate = speed;
    void audio.play().catch(() => {});
  }, [streamToken, episodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
    localStorage.setItem(SPEED_KEY, String(speed));
  }, [speed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !episodeId) return;
    setCurrentTime(audio.currentTime);
    const now = Date.now();
    if (now - lastSaveRef.current > 10000 && audio.currentTime > 0) {
      lastSaveRef.current = now;
      api
        .put(`/podcasts/episodes/${episodeId}/progress`, {
          currentTime: audio.currentTime,
        })
        .catch(() => {});
    }
  }, [episodeId]);

  const handleCanPlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !episodeId || restoredRef.current) return;
    restoredRef.current = true;
    const initialPos = playerState?.initialPosition;
    if (
      initialPos &&
      initialPos > 0 &&
      initialPos < (audio.duration || Infinity) - 5
    ) {
      audio.currentTime = initialPos;
    }
  }, [episodeId, playerState?.initialPosition]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seekRelative = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration || 0, audio.currentTime + delta),
    );
  }, []);

  const cycleSpeed = () => {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev);
      return SPEEDS[(idx + 1) % SPEEDS.length];
    });
  };

  const closePlayer = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setPlayerState(null);
  };

  if (!playerState) return null;

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const sliderValue = dragValue ?? progressPercent;
  const remaining = Math.max(0, duration - currentTime);
  const effectiveVolume = isMuted ? 0 : volume;

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
        onCanPlay={handleCanPlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        preload="metadata"
        style={{ display: 'none' }}
      />
      <Box
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'stretch',
          borderTop: '1px solid var(--mantine-color-default-border)',
          background: 'var(--mantine-color-body)',
        }}
      >
        {/* Left: artwork + title */}
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
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt=""
              style={{
                width: 56,
                height: 56,
                objectFit: 'cover',
                borderRadius: 4,
                flexShrink: 0,
              }}
            />
          ) : (
            <Box
              style={{
                width: 56,
                height: 56,
                borderRadius: 4,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--mantine-color-default-border)',
              }}
            >
              <IconMicrophone size={24} style={{ opacity: 0.5 }} />
            </Box>
          )}
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>
              {episodeTitle}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {podcastTitle}
            </Text>
          </Box>
        </Group>

        {/* Center: controls + seek */}
        <Box
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '10px 24px',
            gap: 6,
          }}
        >
          <Group justify="center" gap={4}>
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
          </Group>
          <Group gap={8} align="center" wrap="nowrap">
            <Text
              size="xs"
              c="dimmed"
              style={{ flexShrink: 0, width: 42, textAlign: 'right' }}
            >
              {formatTime(currentTime)}
            </Text>
            <Slider
              value={sliderValue}
              min={0}
              max={100}
              step={0.01}
              label={formatTime((sliderValue / 100) * duration)}
              size="xs"
              style={{ flex: 1 }}
              onChange={(v) => setDragValue(v)}
              onChangeEnd={(v) => {
                setDragValue(null);
                const audio = audioRef.current;
                if (audio && isFinite(audio.duration)) {
                  audio.currentTime = (v / 100) * audio.duration;
                }
              }}
              styles={{ thumb: { width: 10, height: 10 } }}
            />
            <Text size="xs" c="dimmed" style={{ flexShrink: 0, width: 50 }}>
              -{formatTime(remaining)}
            </Text>
          </Group>
        </Box>

        {/* Right: volume + speed + close */}
        <Group gap={6} px="md" style={{ flexShrink: 0, alignItems: 'center' }}>
          <Tooltip label={isMuted ? 'Unmute' : 'Mute'}>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => setIsMuted((m) => !m)}
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
            onChange={(v) => {
              setVolume(v);
              if (isMuted && v > 0) setIsMuted(false);
            }}
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
