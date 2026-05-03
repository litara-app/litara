import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import TrackPlayer, {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import { getEpisodes, requestEpisodeDownload } from '@/src/api/podcasts';
import { formatTime } from '@/src/utils/formatTime';

const SPEEDS = [0.5, 1.0, 1.5, 2.0];
const SPEED_KEY = 'litara-podcast-speed';

interface Props {
  episodeId: string;
}

export function PodcastPlayerScreen({ episodeId }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [speed, setSpeed] = useState(1.0);

  const track = useActiveTrack();
  const progress = useProgress(500);
  const { state } = usePlaybackState();

  const isPlaying = state === State.Playing;
  const duration = track?.duration ?? 0;
  const currentTime = progress.position;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Extract podcastId from track id: "podcast:{podcastId}:{episodeId}"
  const podcastId = track?.id?.split(':')?.[1] ?? null;

  const { data: episodesData } = useQuery({
    queryKey: ['podcast-episodes', podcastId],
    queryFn: () => getEpisodes(podcastId!),
    enabled: !!podcastId,
    staleTime: 30_000,
  });

  const episode = episodesData?.episodes.find((e) => e.id === episodeId);
  const downloadStatus = episode?.downloadStatus ?? null;

  const downloadMutation = useMutation({
    mutationFn: () => requestEpisodeDownload(episodeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['podcast-episodes', podcastId],
      });
    },
  });

  useEffect(() => {
    AsyncStorage.getItem(SPEED_KEY).then((val) => {
      if (val) setSpeed(parseFloat(val));
    });
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) void TrackPlayer.pause();
    else void TrackPlayer.play();
  }, [isPlaying]);

  const seekRelative = useCallback(
    (delta: number) => {
      void TrackPlayer.seekTo(Math.max(0, progress.position + delta));
    },
    [progress.position],
  );

  const cycleSpeed = useCallback(async () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    await TrackPlayer.setRate(next);
    await AsyncStorage.setItem(SPEED_KEY, String(next));
  }, [speed]);

  const onSlidingComplete = useCallback(
    (value: number) => {
      void TrackPlayer.seekTo((value / 100) * duration);
    },
    [duration],
  );

  if (!track) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Image
        source={track.artwork ? { uri: track.artwork as string } : undefined}
        style={styles.cover}
        contentFit="contain"
      />

      <Text style={styles.title} numberOfLines={2}>
        {track.title ?? 'Unknown Episode'}
      </Text>
      <Text style={styles.author} numberOfLines={1}>
        {track.artist ?? ''}
      </Text>

      <View style={styles.seekRow}>
        <Text style={styles.dimText}>{formatTime(currentTime)}</Text>
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
          -{formatTime(Math.max(0, duration - currentTime))}
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

        <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={34}
            color="#000"
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

        {(downloadStatus === 'NOT_DOWNLOADED' ||
          downloadStatus === 'FAILED') && (
          <TouchableOpacity
            onPress={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            style={styles.speedBtn}
          >
            {downloadMutation.isPending ? (
              <ActivityIndicator size="small" color="#aaa" />
            ) : (
              <Ionicons name="download-outline" size={20} color="#aaa" />
            )}
          </TouchableOpacity>
        )}

        {(downloadStatus === 'DOWNLOADING' || downloadStatus === 'PENDING') && (
          <View style={styles.speedBtn}>
            <ActivityIndicator size="small" color="#4a9eff" />
          </View>
        )}

        {downloadStatus === 'DOWNLOADED' && (
          <View style={styles.speedBtn}>
            <Ionicons name="cloud-done-outline" size={20} color="#4ade80" />
          </View>
        )}
      </View>
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
  author: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
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
    gap: 32,
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
});
