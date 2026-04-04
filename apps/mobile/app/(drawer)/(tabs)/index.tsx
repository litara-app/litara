import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { BookCard } from '@/src/components/BookCard';
import { BookOptionsSheet } from '@/src/components/BookOptionsSheet';
import { getBooks } from '@/src/api/books';
import type { BookSummary } from '@/src/api/books';

const CARD_WIDTH = 110;

export default function DashboardScreen() {
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['books', 'dashboard'],
    queryFn: () => getBooks({ limit: 40, sortBy: 'createdAt', order: 'desc' }),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const books = data ?? [];
  const recentlyAdded = books.slice(0, 20);
  const inProgress = books.filter(
    (b) =>
      b.readingProgress != null &&
      b.readingProgress > 0 &&
      b.readingProgress < 100,
  );

  const renderCard = (item: BookSummary) => (
    <Pressable
      style={styles.cardWrapper}
      onPress={() =>
        router.push({ pathname: '/book/[id]', params: { id: item.id } })
      }
      onLongPress={() => setSelectedBook(item)}
      delayLongPress={400}
    >
      <BookCard book={item} />
    </Pressable>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#4a9eff"
        />
      }
    >
      {inProgress.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Continue Reading</Text>
          <FlatList
            horizontal
            data={inProgress}
            keyExtractor={(b) => b.id}
            renderItem={({ item }) => renderCard(item)}
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
            renderItem={({ item }) => renderCard(item)}
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
  cardWrapper: {
    width: CARD_WIDTH,
    marginHorizontal: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  spinner: { margin: 20 },
  emptyText: { color: '#555', fontSize: 14, paddingHorizontal: 16 },
});
