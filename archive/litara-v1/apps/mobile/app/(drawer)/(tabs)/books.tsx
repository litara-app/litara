import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '@/src/context/AuthContext';
import { useGridSize } from '@/src/context/GridSizeContext';
import { BookCard } from '@/src/components/BookCard';
import { BookOptionsSheet } from '@/src/components/BookOptionsSheet';
import { BookFilterSheet } from '@/src/components/BookFilterSheet';
import { getAllBooks } from '@/src/api/books';
import type { BookSummary } from '@/src/api/books';
import { useBookFilter } from '@/src/hooks/useBookFilter';

const GRID_ICONS: Record<number, keyof typeof Ionicons.glyphMap> = {
  2: 'grid-outline',
  3: 'apps-outline',
  4: 'grid',
};

export default function AllBooksScreen() {
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { clearToken, clearServerUrl } = useAuthContext();
  const { numColumns, cycleColumns } = useGridSize();
  const navigation = useNavigation();

  const {
    data: allBooks = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['all-books'],
    queryFn: getAllBooks,
  });

  const {
    filters,
    setFilters,
    filteredBooks,
    activeCount,
    availableGenres,
    availableTags,
    availableFormats,
    availableMoods,
    availablePublishers,
    availableAuthors,
  } = useBookFilter(allBooks);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerBtns}>
          <Pressable
            onPress={() => setFilterSheetOpen(true)}
            hitSlop={8}
            style={styles.headerBtn}
          >
            <Ionicons
              name={activeCount > 0 ? 'filter' : 'filter-outline'}
              size={22}
              color={activeCount > 0 ? '#4a9eff' : '#fff'}
            />
            {activeCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={cycleColumns}
            hitSlop={8}
            style={styles.headerBtn}
          >
            <Ionicons name={GRID_ICONS[numColumns]} size={22} color="#fff" />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, numColumns, cycleColumns, activeCount]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  useEffect(() => {
    if (isError && isAxiosError(error) && error.response?.status === 401) {
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
    if (isAxiosError(error)) {
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
      {activeCount > 0 && (
        <View style={styles.filterBar}>
          <Ionicons name="filter" size={14} color="#4a9eff" />
          <Text style={styles.filterBarText}>
            {filteredBooks.length} of {allBooks.length} books
          </Text>
          <Pressable
            onPress={() =>
              setFilters({ ...filters, filterMode: filters.filterMode })
            }
          />
        </View>
      )}
      <FlatList<BookSummary>
        key={numColumns}
        data={filteredBooks}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#4a9eff"
          />
        }
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
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>
              {allBooks.length === 0
                ? 'No books in your library yet.'
                : 'No books match the current filters.'}
            </Text>
          </View>
        }
      />
      <BookOptionsSheet
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
      />
      <BookFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={filters}
        setFilters={setFilters}
        activeCount={activeCount}
        availableGenres={availableGenres}
        availableTags={availableTags}
        availableFormats={availableFormats}
        availableMoods={availableMoods}
        availablePublishers={availablePublishers}
        availableAuthors={availableAuthors}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { paddingHorizontal: 10, paddingBottom: 20, paddingTop: 8 },
  cardWrapper: { flex: 1, margin: 6, borderRadius: 8, overflow: 'hidden' },
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    gap: 4,
  },
  headerBtn: {
    padding: 8,
  },
  filterBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#4a9eff',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '700',
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  filterBarText: {
    color: '#4a9eff',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
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
});
