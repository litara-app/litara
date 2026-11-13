import { useEffect, useState } from 'react';
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
import { router, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BookCard } from '@/src/components/BookCard';
import { BookOptionsSheet } from '@/src/components/BookOptionsSheet';
import { useGridSize } from '@/src/context/GridSizeContext';
import { getSmartShelves, getSmartShelfBooks } from '@/src/api/smart-shelves';
import type { SmartShelf } from '@/src/api/smart-shelves';
import type { BookSummary } from '@/src/api/books';

const GRID_ICONS: Record<number, keyof typeof Ionicons.glyphMap> = {
  2: 'grid-outline',
  3: 'apps-outline',
  4: 'grid',
};

export default function SmartShelvesScreen() {
  const [selectedShelf, setSelectedShelf] = useState<SmartShelf | null>(null);
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { numColumns, cycleColumns } = useGridSize();
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={cycleColumns}
          hitSlop={8}
          style={{ marginRight: 16 }}
        >
          <Ionicons name={GRID_ICONS[numColumns]} size={22} color="#fff" />
        </Pressable>
      ),
    });
  }, [navigation, numColumns, cycleColumns]);

  const {
    data: shelves = [],
    isLoading: shelvesLoading,
    refetch: refetchShelves,
  } = useQuery({
    queryKey: ['smart-shelves'],
    queryFn: getSmartShelves,
  });

  const activeShelf = selectedShelf ?? shelves[0] ?? null;

  const {
    data: shelfData,
    isLoading: booksLoading,
    refetch: refetchBooks,
  } = useQuery({
    queryKey: ['smart-shelf-books', activeShelf?.id],
    queryFn: () => getSmartShelfBooks(activeShelf!.id),
    enabled: !!activeShelf,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchShelves(), refetchBooks()]);
    setRefreshing(false);
  };

  const books = shelfData?.books ?? [];

  if (shelvesLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  if (shelves.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyHeading}>No smart shelves yet</Text>
        <Text style={styles.emptySubtext}>
          Create smart shelves in the web app to automatically group books by
          genre, tag, or other criteria.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Shelf selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.selectorRow}
        contentContainerStyle={styles.selectorContent}
      >
        {shelves.map((shelf) => {
          const active = shelf.id === activeShelf?.id;
          return (
            <Pressable
              key={shelf.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setSelectedShelf(shelf)}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {shelf.name}
              </Text>
              <Text style={[styles.tabCount, active && styles.tabCountActive]}>
                {shelf.ruleCount} {shelf.ruleCount === 1 ? 'rule' : 'rules'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Books count */}
      {!booksLoading && shelfData && (
        <Text style={styles.resultCount}>
          {shelfData.total} {shelfData.total === 1 ? 'book' : 'books'}
        </Text>
      )}

      {/* Books grid */}
      {booksLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4a9eff" />
        </View>
      ) : (
        <FlatList<BookSummary>
          key={numColumns}
          data={books}
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
              <Text style={styles.emptyText}>No books match this shelf.</Text>
            </View>
          }
        />
      )}

      <BookOptionsSheet
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyHeading: {
    color: '#ccc',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptySubtext: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyText: { color: '#666', fontSize: 15, textAlign: 'center' },
  // Shelf selector
  selectorRow: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  selectorContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#1c2a40',
  },
  tabLabel: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#4a9eff',
    fontWeight: '700',
  },
  tabCount: {
    color: '#555',
    fontSize: 10,
    marginTop: 1,
  },
  tabCountActive: {
    color: '#4a9eff88',
  },
  resultCount: {
    color: '#555',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  // Books grid
  list: { paddingHorizontal: 10, paddingBottom: 20, paddingTop: 4 },
  cardWrapper: { flex: 1, margin: 6, borderRadius: 8, overflow: 'hidden' },
});
