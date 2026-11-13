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
import { getAllSeries } from '@/src/api/series';
import type { SeriesListItem, SeriesCoverBook } from '@/src/api/series';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

function coverUri(bookId: string, coverUpdatedAt: string) {
  const base = serverUrlStore.get();
  return base
    ? {
        uri: `${base}/api/v1/books/${bookId}/cover?t=${coverUpdatedAt}`,
        headers: tokenStore.get()
          ? { Authorization: `Bearer ${tokenStore.get()}` }
          : undefined,
      }
    : null;
}

function CoverStack({ coverBooks }: { coverBooks: SeriesCoverBook[] }) {
  if (coverBooks.length === 0) {
    return (
      <View style={styles.coverPlaceholder}>
        <Ionicons name="albums-outline" size={28} color="#444" />
      </View>
    );
  }

  // Show up to 2 covers stacked with a slight offset
  const visible = coverBooks.slice(0, 2).reverse();
  return (
    <View style={styles.coverStack}>
      {visible.map((cb, i) => {
        const src = coverUri(cb.id, cb.coverUpdatedAt);
        const isTop = i === visible.length - 1;
        return (
          <Image
            key={cb.id}
            source={src ?? require('@/assets/images/icon.png')}
            style={[
              styles.stackCover,
              {
                left: i * 6,
                zIndex: i,
                opacity: isTop ? 1 : 0.6,
              },
            ]}
            contentFit="cover"
            transition={200}
          />
        );
      })}
    </View>
  );
}

function SeriesRow({ item }: { item: SeriesListItem }) {
  const bookLabel =
    item.totalBooks != null
      ? `${item.ownedCount} / ${item.totalBooks} books`
      : `${item.ownedCount} book${item.ownedCount !== 1 ? 's' : ''}`;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        router.push({ pathname: '/series/[id]', params: { id: item.id } })
      }
      android_ripple={{ color: '#ffffff10' }}
    >
      <CoverStack coverBooks={item.coverBooks} />
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={2}>
          {item.name}
        </Text>
        {item.authors.length > 0 && (
          <Text style={styles.rowAuthors} numberOfLines={1}>
            {item.authors.join(', ')}
          </Text>
        )}
        <Text style={styles.rowCount}>{bookLabel}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#444" />
    </Pressable>
  );
}

export default function SeriesScreen() {
  const {
    data: seriesList = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['all-series'],
    queryFn: getAllSeries,
  });

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  if (seriesList.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="albums-outline" size={48} color="#333" />
        <Text style={styles.emptyTitle}>No series found</Text>
        <Text style={styles.emptySubtitle}>
          Books with series metadata will appear here
        </Text>
      </View>
    );
  }

  return (
    <FlatList<SeriesListItem>
      style={styles.container}
      data={seriesList}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <SeriesRow item={item} />}
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

const COVER_H = 64;
const COVER_W = (COVER_H * 2) / 3;
const STACK_WIDTH = COVER_W + 6; // offset for second cover

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

  // Row
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
  rowAuthors: { color: '#888', fontSize: 13, marginTop: 2 },
  rowCount: { color: '#4a9eff', fontSize: 12, marginTop: 4, fontWeight: '500' },

  separator: {
    height: 1,
    backgroundColor: '#1c1c1e',
    marginHorizontal: 16,
  },

  // Cover stack
  coverStack: {
    width: STACK_WIDTH,
    height: COVER_H,
    position: 'relative',
  },
  stackCover: {
    position: 'absolute',
    width: COVER_W,
    height: COVER_H,
    borderRadius: 4,
    backgroundColor: '#1c1c1e',
  },
  coverPlaceholder: {
    width: STACK_WIDTH,
    height: COVER_H,
    backgroundColor: '#1c1c1e',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
