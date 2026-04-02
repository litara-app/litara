import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthContext } from '@/src/context/AuthContext';
import { BookCard } from '@/src/components/BookCard';
import { BookOptionsSheet } from '@/src/components/BookOptionsSheet';
import { getBooks } from '@/src/api/books';
import type { BookSummary } from '@/src/api/books';

const PAGE_SIZE = 40;

export default function AllBooksScreen() {
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const { clearToken, clearServerUrl } = useAuthContext();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['books'],
    queryFn: ({ pageParam = 0 }) =>
      getBooks({
        limit: PAGE_SIZE,
        offset: pageParam as number,
        sortBy: 'title',
        order: 'asc',
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.length * PAGE_SIZE;
    },
  });

  const books = data?.pages.flat() ?? [];

  useEffect(() => {
    if (
      isError &&
      axios.isAxiosError(error) &&
      error.response?.status === 401
    ) {
      clearToken();
    }
  }, [isError, error, clearToken]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  if (isError) {
    let detail = 'Unknown error';
    if (axios.isAxiosError(error)) {
      if (!error.response) {
        detail = 'Network error — cannot reach server';
      } else {
        const d = error.response.data as { message?: string } | undefined;
        detail = `HTTP ${error.response.status}: ${d?.message ?? error.message}`;
      }
    } else if (error instanceof Error) {
      detail = error.message;
    }
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load library</Text>
        <Text style={styles.errorDetail}>{detail}</Text>
        <View style={styles.buttonRow}>
          <Pressable style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => clearServerUrl()}
          >
            <Text style={styles.secondaryText}>Change server</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList<BookSummary>
        data={books}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.cardWrapper}
            onPress={() =>
              router.push({ pathname: '/book/[id]', params: { id: item.id } })
            }
            onLongPress={() => setSelectedBook(item)}
            delayLongPress={400}
            android_ripple={{ color: '#ffffff18' }}
          >
            <BookCard book={item} />
          </Pressable>
        )}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator style={styles.footer} color="#4a9eff" />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No books in your library yet.</Text>
          </View>
        }
      />
      <BookOptionsSheet
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { paddingHorizontal: 10, paddingBottom: 20, paddingTop: 8 },
  cardWrapper: { flex: 1, margin: 6, borderRadius: 8, overflow: 'hidden' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: { color: '#ff6b6b', fontSize: 15, textAlign: 'center' },
  errorDetail: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
  },
  retryText: { color: '#4a9eff', fontSize: 14, fontWeight: '600' },
  secondaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
  },
  secondaryText: { color: '#888', fontSize: 14, fontWeight: '600' },
  emptyText: { color: '#666', fontSize: 15, textAlign: 'center' },
  footer: { paddingVertical: 20 },
});
