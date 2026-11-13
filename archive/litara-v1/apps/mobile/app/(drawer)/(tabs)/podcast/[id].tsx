import { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPodcast,
  getEpisodes,
  requestEpisodeDownload,
  refreshPodcast,
  unsubscribePodcast,
} from '@/src/api/podcasts';
import { loadPodcastEpisode } from '@/src/services/playback/loadPodcastEpisode';
import { formatTime } from '@/src/utils/formatTime';
import type { PodcastEpisode } from '@/src/api/podcasts';

const STATUS_COLOR: Record<PodcastEpisode['downloadStatus'], string> = {
  DOWNLOADED: '#2ecc71',
  DOWNLOADING: '#4a9eff',
  PENDING: '#f0a500',
  NOT_DOWNLOADED: '#555',
  FAILED: '#ff6b6b',
};

const STATUS_LABEL: Record<PodcastEpisode['downloadStatus'], string> = {
  DOWNLOADED: 'Downloaded',
  DOWNLOADING: 'Downloading',
  PENDING: 'Pending',
  NOT_DOWNLOADED: 'Not downloaded',
  FAILED: 'Failed',
};

export default function PodcastDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [playingId, setPlayingId] = useState<string | null>(null);

  const { data: podcast, isLoading: podcastLoading } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });

  const {
    data: episodesData,
    isLoading: episodesLoading,
    refetch,
  } = useQuery({
    queryKey: ['podcast-episodes', id],
    queryFn: () => getEpisodes(id!),
    enabled: !!id,
  });

  const episodes = episodesData?.episodes ?? [];

  useEffect(() => {
    navigation.setOptions({
      title: podcast?.title ?? 'Podcast',
      headerLeft: () => (
        <Pressable
          onPress={() => router.back()}
          style={{ paddingLeft: 8 }}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
      ),
    });
  }, [navigation, podcast?.title]);

  const downloadMutation = useMutation({
    mutationFn: (episodeId: string) => requestEpisodeDownload(episodeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['podcast-episodes', id],
      });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshPodcast(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['podcast', id] });
      void queryClient.invalidateQueries({
        queryKey: ['podcast-episodes', id],
      });
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: ({ deleteFiles }: { deleteFiles: boolean }) =>
      unsubscribePodcast(id!, deleteFiles),
    onSuccess: () => {
      router.back();
    },
  });

  function handleUnsubscribePress() {
    if (!podcast) return;
    Alert.alert('Unsubscribe', `Unsubscribe from "${podcast.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Keep files',
        onPress: () => unsubscribeMutation.mutate({ deleteFiles: false }),
      },
      {
        text: 'Delete files',
        style: 'destructive',
        onPress: () => unsubscribeMutation.mutate({ deleteFiles: true }),
      },
    ]);
  }

  async function handlePlay(episode: PodcastEpisode) {
    if (!podcast) return;
    setPlayingId(episode.id);
    try {
      await loadPodcastEpisode({
        podcastId: podcast.id,
        episodeId: episode.id,
        episodeTitle: episode.title,
        podcastTitle: podcast.title,
        artworkUrl: podcast.artworkUrl,
        duration: episode.duration,
        initialPosition: episode.currentTime ?? undefined,
      });
    } finally {
      setPlayingId(null);
    }
  }

  if (podcastLoading || episodesLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  if (!podcast) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Podcast not found.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={episodes}
      keyExtractor={(e) => e.id}
      refreshing={episodesLoading}
      onRefresh={() => void refetch()}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.artwork}>
            {podcast.artworkUrl ? (
              <Image
                source={{ uri: podcast.artworkUrl }}
                style={styles.artworkImage}
              />
            ) : (
              <Ionicons name="mic-outline" size={36} color="#555" />
            )}
          </View>
          <Text style={styles.podcastTitle}>{podcast.title}</Text>
          {podcast.author ? (
            <Text style={styles.podcastAuthor}>{podcast.author}</Text>
          ) : null}
          {podcast.description ? (
            <Text style={styles.podcastDesc} numberOfLines={3}>
              {podcast.description}
            </Text>
          ) : null}
          <Text style={styles.episodeCount}>
            {podcast.episodeCount} episodes
          </Text>
          <View style={styles.headerActions}>
            {podcast.subscribed && (
              <Pressable
                onPress={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                style={styles.refreshBtn}
              >
                {refreshMutation.isPending ? (
                  <ActivityIndicator size="small" color="#4a9eff" />
                ) : (
                  <Text style={styles.refreshBtnText}>Refresh Feed</Text>
                )}
              </Pressable>
            )}
            {podcast.subscribed && (
              <Pressable
                onPress={handleUnsubscribePress}
                disabled={unsubscribeMutation.isPending}
                style={styles.unsubscribeBtn}
              >
                {unsubscribeMutation.isPending ? (
                  <ActivityIndicator size="small" color="#ff6b6b" />
                ) : (
                  <Text style={styles.unsubscribeBtnText}>Unsubscribe</Text>
                )}
              </Pressable>
            )}
          </View>
          <View style={styles.divider} />
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No episodes yet.</Text>
      }
      renderItem={({ item: episode }) => (
        <View style={styles.episodeCard}>
          <View style={styles.episodeInfo}>
            <Text style={styles.episodeTitle} numberOfLines={2}>
              {episode.title}
            </Text>
            <View style={styles.episodeMeta}>
              {episode.publishedAt ? (
                <Text style={styles.metaText}>
                  {new Date(episode.publishedAt).toLocaleDateString()}
                </Text>
              ) : null}
              {episode.downloadStatus === 'DOWNLOADED' &&
              (episode.currentTime ?? 0) > 0 &&
              episode.duration ? (
                <Text style={styles.progressText}>
                  {formatTime(episode.currentTime!)} /{' '}
                  {formatTime(episode.duration)}
                </Text>
              ) : episode.duration ? (
                <Text style={styles.metaText}>
                  {formatTime(episode.duration)}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.statusBadge,
                  { color: STATUS_COLOR[episode.downloadStatus] },
                ]}
              >
                {STATUS_LABEL[episode.downloadStatus]}
              </Text>
            </View>
            {episode.downloadStatus === 'DOWNLOADED' &&
            (episode.currentTime ?? 0) > 0 &&
            episode.duration ? (
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min((episode.currentTime! / episode.duration) * 100, 100)}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
          <View style={styles.episodeActions}>
            {episode.downloadStatus === 'DOWNLOADED' ? (
              <Pressable
                onPress={() => void handlePlay(episode)}
                disabled={playingId === episode.id}
                style={styles.actionBtn}
              >
                {playingId === episode.id ? (
                  <ActivityIndicator size="small" color="#4a9eff" />
                ) : (
                  <Ionicons name="play-circle" size={28} color="#4a9eff" />
                )}
              </Pressable>
            ) : episode.downloadStatus === 'NOT_DOWNLOADED' ||
              episode.downloadStatus === 'FAILED' ? (
              <Pressable
                onPress={() => downloadMutation.mutate(episode.id)}
                disabled={downloadMutation.isPending}
                style={styles.actionBtn}
              >
                <Ionicons name="download-outline" size={24} color="#888" />
              </Pressable>
            ) : (
              <View style={styles.actionBtn}>
                <ActivityIndicator size="small" color="#4a9eff" />
              </View>
            )}
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
  },
  errorText: { color: '#ff6b6b', fontSize: 15 },
  listContent: { paddingBottom: 32, backgroundColor: '#0a0a0a' },
  header: { alignItems: 'center', padding: 20, gap: 8 },
  artwork: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 8,
  },
  artworkImage: { width: 120, height: 120 },
  podcastTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  podcastAuthor: { color: '#888', fontSize: 14, textAlign: 'center' },
  podcastDesc: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  episodeCount: { color: '#4a9eff', fontSize: 13, marginTop: 4 },
  divider: {
    height: 1,
    backgroundColor: '#1c1c1e',
    width: '100%',
    marginTop: 16,
  },
  episodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
    gap: 10,
  },
  episodeInfo: { flex: 1, gap: 4 },
  episodeTitle: { color: '#fff', fontSize: 14, fontWeight: '500' },
  episodeMeta: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  metaText: { color: '#666', fontSize: 12 },
  statusBadge: { fontSize: 12, fontWeight: '500' },
  episodeActions: { alignItems: 'center', justifyContent: 'center', width: 40 },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
  progressText: { color: '#4a9eff', fontSize: 12 },
  progressBarBg: {
    height: 3,
    backgroundColor: '#1c1c1e',
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 3,
    backgroundColor: '#4a9eff',
    borderRadius: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  refreshBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    minWidth: 120,
    alignItems: 'center',
  },
  refreshBtnText: { color: '#4a9eff', fontSize: 13, fontWeight: '600' },
  unsubscribeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    minWidth: 120,
    alignItems: 'center',
  },
  unsubscribeBtnText: { color: '#ff6b6b', fontSize: 13, fontWeight: '600' },
});
