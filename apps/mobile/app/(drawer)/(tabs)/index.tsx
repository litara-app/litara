import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { BookOptionsSheet } from '@/src/components/BookOptionsSheet';
import { getBooks } from '@/src/api/books';
import type { BookSummary } from '@/src/api/books';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

function CoverThumb({ book }: { book: BookSummary }) {
  const baseUrl = serverUrlStore.get();
  const token = tokenStore.get();
  const source =
    book.hasCover && baseUrl
      ? {
          uri: `${baseUrl}/api/v1/books/${book.id}/cover`,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      : require('@/assets/images/icon.png');

  return (
    <Pressable
      style={styles.thumbWrapper}
      onPress={() =>
        router.push({ pathname: '/book/[id]', params: { id: book.id } })
      }
    >
      <Image source={source} style={styles.thumb} contentFit="cover" />
      <Text style={styles.thumbTitle} numberOfLines={2}>
        {book.title}
      </Text>
    </Pressable>
  );
}

export default function DashboardScreen() {
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['books', 'dashboard'],
    queryFn: () => getBooks({ limit: 40, sortBy: 'createdAt', order: 'desc' }),
  });

  const books = data ?? [];
  const recentlyAdded = books.slice(0, 20);
  const inProgress = books.filter(
    (b) =>
      b.readingProgress != null &&
      b.readingProgress > 0 &&
      b.readingProgress < 100,
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {inProgress.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Continue Reading</Text>
          <FlatList
            horizontal
            data={inProgress}
            keyExtractor={(b) => b.id}
            renderItem={({ item }) => (
              <Pressable
                onLongPress={() => setSelectedBook(item)}
                delayLongPress={400}
              >
                <CoverThumb book={item} />
              </Pressable>
            )}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recently Added</Text>
        {isLoading ? (
          <ActivityIndicator color="#4a9eff" style={styles.spinner} />
        ) : recentlyAdded.length === 0 ? (
          <Text style={styles.emptyText}>No books yet.</Text>
        ) : (
          <FlatList
            horizontal
            data={recentlyAdded}
            keyExtractor={(b) => b.id}
            renderItem={({ item }) => (
              <Pressable
                onLongPress={() => setSelectedBook(item)}
                delayLongPress={400}
              >
                <CoverThumb book={item} />
              </Pressable>
            )}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          />
        )}
      </View>

      <BookOptionsSheet
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingBottom: 32 },
  section: { marginTop: 24 },
  sectionTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  row: { paddingHorizontal: 12 },
  thumbWrapper: { width: 100, marginHorizontal: 4 },
  thumb: { width: 100, height: 150, borderRadius: 6 },
  thumbTitle: {
    color: '#ccc',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 15,
  },
  spinner: { margin: 20 },
  emptyText: { color: '#555', fontSize: 14, paddingHorizontal: 16 },
});
