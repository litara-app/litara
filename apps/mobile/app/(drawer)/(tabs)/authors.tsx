import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getAllAuthors } from '@/src/api/authors';
import type { AuthorListItem } from '@/src/api/authors';
import { serverUrlStore } from '@/src/auth/serverUrlStore';

function photoSource(authorId: string) {
  const base = serverUrlStore.get();
  return base ? { uri: `${base}/api/v1/authors/${authorId}/photo` } : null;
}

function AuthorRow({ item }: { item: AuthorListItem }) {
  const bookLabel = `${item.bookCount} ${item.bookCount === 1 ? 'book' : 'books'}`;
  const src = item.hasCover ? photoSource(item.id) : null;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        router.push({ pathname: '/author/[id]', params: { id: item.id } })
      }
      android_ripple={{ color: '#ffffff10' }}
    >
      {src ? (
        <Image
          source={src}
          style={styles.photo}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}>
          <Ionicons name="person-outline" size={22} color="#444" />
        </View>
      )}

      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.rowCount}>{bookLabel}</Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color="#444" />
    </Pressable>
  );
}

export default function AuthorsScreen() {
  const {
    data: authors = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['all-authors'],
    queryFn: getAllAuthors,
  });

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  if (authors.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="people-outline" size={48} color="#333" />
        <Text style={styles.emptyTitle}>No authors found</Text>
        <Text style={styles.emptySubtitle}>
          Authors will appear here once books are in your library
        </Text>
      </View>
    );
  }

  return (
    <FlatList<AuthorListItem>
      style={styles.container}
      data={authors}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <AuthorRow item={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor="#4a9eff"
        />
      }
      contentContainerStyle={styles.list}
    />
  );
}

const PHOTO_SIZE = 48;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { paddingVertical: 8 },
  centered: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyTitle: {
    color: '#555',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#333',
    fontSize: 14,
    textAlign: 'center',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 14,
  },
  rowPressed: { backgroundColor: '#ffffff08' },
  rowInfo: { flex: 1 },
  rowName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowCount: { color: '#4a9eff', fontSize: 12, marginTop: 4, fontWeight: '500' },

  separator: {
    height: 1,
    backgroundColor: '#1c1c1e',
    marginHorizontal: 16,
  },

  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
    backgroundColor: '#1c1c1e',
    flexShrink: 0,
  },
  photoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
