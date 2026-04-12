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
import { getReadingQueue } from '@/src/api/reading-queue';
import type { ReadingQueueItem } from '@/src/api/reading-queue';

const CARD_WIDTH = 110;

export default function DashboardScreen() {
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const {
    data,
    isLoading,
    refetch: refetchBooks,
  } = useQuery({
    queryKey: ['books', 'dashboard'],
    queryFn: () => getBooks({ limit: 40, sortBy: 'createdAt', order: 'desc' }),
  });

  const { data: readingQueue = [], refetch: refetchQueue } = useQuery({
    queryKey: ['reading-queue'],
    queryFn: getReadingQueue,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchBooks(), refetchQueue()]);
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

  const renderQueueCard = (item: ReadingQueueItem) => {
    const asSummary: BookSummary = {
      id: item.bookId,
      title: item.title,
      authors: item.authors,
      hasCover: item.hasCover,
      coverUpdatedAt: item.coverUpdatedAt,
      formats: item.formats,
      hasFileMissing: item.hasFileMissing,
      readStatus: null,
      rating: null,
      genres: [],
      tags: [],
    };
    return (
      <Pressable
        style={styles.cardWrapper}
        onPress={() =>
          router.push({ pathname: '/book/[id]', params: { id: item.bookId } })
        }
        onLongPress={() => setSelectedBook(asSummary)}
        delayLongPress={400}
      >
        <BookCard book={asSummary} />
      </Pressable>
    );
  };

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
      {readingQueue.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Reading Queue</Text>
            <Pressable onPress={() => router.push('/(drawer)/reading-queue')}>
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>
          <FlatList
            horizontal
            data={readingQueue}
            keyExtractor={(item) => item.bookId}
            renderItem={({ item }) => renderQueueCard(item)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          />
        </View>
      )}

      {inProgress.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.sectionTitlePad]}>
            Continue Reading
          </Text>
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
        <Text style={[styles.sectionTitle, styles.sectionTitlePad]}>
          Recently Added
        </Text>
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  seeAll: {
    color: '#4a9eff',
    fontSize: 13,
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
