import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { useAudiobookDownloads } from '@/src/hooks/useAudiobookDownloads';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';
import { BottomNavBar } from '@/src/components/BottomNavBar';

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function DownloadsScreen() {
  const { downloads, isLoading, deleteDownload, refresh } =
    useAudiobookDownloads();

  // Re-check on focus so the list updates if the user deleted a download
  // from the player screen and then comes back here
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  function handleDelete(bookId: string, title: string) {
    Alert.alert('Delete Download', `Remove the offline copy of "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteDownload(bookId),
      },
    ]);
  }

  const totalBytes = downloads.reduce((sum, d) => sum + d.totalSizeBytes, 0);

  return (
    <View style={styles.screen}>
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4a9eff" />
        </View>
      ) : downloads.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="download-outline" size={48} color="#333" />
          <Text style={styles.emptyTitle}>No downloads</Text>
          <Text style={styles.emptySubtitle}>
            Open an audiobook and tap the download icon to save it for offline
            playback.
          </Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={downloads}
          keyExtractor={(d) => d.bookId}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.headerText}>
                {downloads.length} audiobook{downloads.length !== 1 ? 's' : ''}{' '}
                · {formatSize(totalBytes)}
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => {
            const baseUrl = serverUrlStore.get();
            const token = tokenStore.get();
            const coverSource =
              item.hasCover && baseUrl
                ? {
                    uri: `${baseUrl}/api/v1/books/${item.bookId}/cover`,
                    headers: token
                      ? { Authorization: `Bearer ${token}` }
                      : undefined,
                  }
                : null;

            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
                onPress={() =>
                  router.push({
                    pathname: '/audiobook/[id]',
                    params: { id: item.bookId },
                  })
                }
              >
                {coverSource ? (
                  <Image
                    source={coverSource}
                    style={styles.cover}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.cover, styles.coverPlaceholder]}>
                    <Ionicons name="headset-outline" size={20} color="#444" />
                  </View>
                )}

                <View style={styles.info}>
                  <Text style={styles.title} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.authors.length > 0 && (
                    <Text style={styles.authors} numberOfLines={1}>
                      {item.authors.join(', ')}
                    </Text>
                  )}
                  <Text style={styles.size}>
                    {formatSize(item.totalSizeBytes)}
                  </Text>
                </View>

                <Pressable
                  onPress={() => handleDelete(item.bookId, item.title)}
                  style={styles.deleteBtn}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={20} color="#ff6b6b" />
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}
      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: { color: '#555', fontSize: 17, fontWeight: '600' },
  emptySubtitle: {
    color: '#444',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  headerText: { color: '#555', fontSize: 13 },
  separator: {
    height: 1,
    backgroundColor: '#1c1c1e',
    marginLeft: 76,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: '#0a0a0a',
  },
  rowPressed: { backgroundColor: '#111' },
  cover: { width: 44, height: 66, borderRadius: 4 },
  coverPlaceholder: {
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 3 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600', lineHeight: 19 },
  authors: { color: '#888', fontSize: 12 },
  size: { color: '#555', fontSize: 12 },
  deleteBtn: { padding: 4 },
});
