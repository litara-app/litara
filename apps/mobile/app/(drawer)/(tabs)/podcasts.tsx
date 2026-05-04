import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listPodcasts,
  subscribePodcast,
  unsubscribePodcast,
} from '@/src/api/podcasts';
import type { Podcast } from '@/src/api/podcasts';

export default function PodcastsScreen() {
  const queryClient = useQueryClient();
  const [addVisible, setAddVisible] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [addError, setAddError] = useState('');

  const {
    data: podcasts = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['podcasts'],
    queryFn: listPodcasts,
  });

  const subscribeMutation = useMutation({
    mutationFn: (url: string) => subscribePodcast(url),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      setAddVisible(false);
      setFeedUrl('');
      setAddError('');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setAddError(
        err?.response?.data?.message ?? 'Failed to subscribe to feed.',
      );
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: ({ id, deleteFiles }: { id: string; deleteFiles: boolean }) =>
      unsubscribePodcast(id, deleteFiles),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['podcasts'] });
    },
  });

  const isLocal = (podcast: Podcast) => podcast.feedUrl?.startsWith('local://');

  function handleLongPress(podcast: Podcast) {
    if (!podcast.subscribed && !isLocal(podcast)) {
      Alert.alert('Re-subscribe', `Re-subscribe to "${podcast.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Re-subscribe',
          onPress: () => subscribeMutation.mutate(podcast.feedUrl),
        },
      ]);
      return;
    }
    if (!podcast.subscribed) return; // local imported — no action on long press

    Alert.alert('Unsubscribe', `Unsubscribe from "${podcast.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Keep files',
        onPress: () =>
          unsubscribeMutation.mutate({ id: podcast.id, deleteFiles: false }),
      },
      {
        text: 'Delete files',
        style: 'destructive',
        onPress: () =>
          unsubscribeMutation.mutate({ id: podcast.id, deleteFiles: true }),
      },
    ]);
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={podcasts}
        keyExtractor={(p) => p.id}
        refreshing={isLoading}
        onRefresh={() => void refetch()}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="mic-outline" size={48} color="#444" />
            <Text style={styles.emptyText}>No podcasts yet.</Text>
            <Text style={styles.emptySubtext}>
              Tap + to subscribe to a feed.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, !item.subscribed && styles.cardUnsubscribed]}
            onPress={() =>
              (item.subscribed || isLocal(item)) &&
              router.push(`/(drawer)/(tabs)/podcast/${item.id}`)
            }
            onLongPress={() => handleLongPress(item)}
          >
            <View style={styles.artwork}>
              {item.artworkUrl ? (
                <Image
                  source={{ uri: item.artworkUrl }}
                  style={styles.artworkImage}
                />
              ) : (
                <Ionicons name="mic-outline" size={28} color="#555" />
              )}
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              {item.author ? (
                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  {item.author}
                </Text>
              ) : null}
              {item.subscribed ? (
                <Text style={styles.cardMeta}>
                  {item.episodeCount} episodes
                </Text>
              ) : isLocal(item) ? (
                <Text style={styles.cardUnsubscribedLabel}>
                  Imported · {item.episodeCount} episodes
                </Text>
              ) : (
                <Text style={styles.cardUnsubscribedLabel}>
                  Unsubscribed · Long-press to re-subscribe
                </Text>
              )}
            </View>
            {(item.subscribed || isLocal(item)) && (
              <Ionicons name="chevron-forward" size={16} color="#555" />
            )}
          </Pressable>
        )}
      />

      <Pressable style={styles.fab} onPress={() => setAddVisible(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>

      <Modal
        visible={addVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setAddVisible(false)}
        />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Add Podcast</Text>
          <TextInput
            style={styles.input}
            placeholder="RSS feed URL"
            placeholderTextColor="#555"
            value={feedUrl}
            onChangeText={setFeedUrl}
            autoCapitalize="none"
            keyboardType="url"
          />
          {addError ? <Text style={styles.error}>{addError}</Text> : null}
          <Pressable
            style={[
              styles.subscribeBtn,
              (!feedUrl.trim() || subscribeMutation.isPending) &&
                styles.btnDisabled,
            ]}
            disabled={!feedUrl.trim() || subscribeMutation.isPending}
            onPress={() => subscribeMutation.mutate(feedUrl.trim())}
          >
            {subscribeMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.subscribeBtnText}>Subscribe</Text>
            )}
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
  },
  listContent: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', marginTop: 80, gap: 8 },
  emptyText: { color: '#666', fontSize: 16 },
  emptySubtext: { color: '#444', fontSize: 13 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1c1c1e',
  },
  cardUnsubscribed: { opacity: 0.5 },
  artwork: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artworkImage: { width: 56, height: 56 },
  cardInfo: { flex: 1, gap: 3 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cardSubtitle: { color: '#888', fontSize: 12 },
  cardMeta: { color: '#4a9eff', fontSize: 11 },
  cardUnsubscribedLabel: { color: '#666', fontSize: 11 },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4a9eff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  error: { color: '#ff6b6b', fontSize: 13 },
  subscribeBtn: {
    backgroundColor: '#4a9eff',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  subscribeBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
