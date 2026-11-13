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
import { getShelves, getShelfBooks } from '@/src/api/shelves';
import type { Shelf } from '@/src/api/shelves';
import type { BookSummary } from '@/src/api/books';

const GRID_ICONS: Record<number, keyof typeof Ionicons.glyphMap> = {
  2: 'grid-outline',
  3: 'apps-outline',
  4: 'grid',
};

export default function ShelvesScreen() {
  const [selectedShelf, setSelectedShelf] = useState<Shelf | null>(null);
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
    queryKey: ['shelves'],
    queryFn: getShelves,
  });

  const activeShelf = selectedShelf ?? shelves[0] ?? null;

  const {
    data: books = [],
    isLoading: booksLoading,
    refetch: refetchBooks,
  } = useQuery({
    queryKey: ['shelf-books', activeShelf?.id],
    queryFn: () => getShelfBooks(activeShelf!.id),
    enabled: !!activeShelf,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchShelves(), refetchBooks()]);
    setRefreshing(false);
  };

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
        <Text style={styles.emptyText}>No shelves found.</Text>
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
            </Pressable>
          );
        })}
      </ScrollView>

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
              <Text style={styles.emptyText}>No books on this shelf.</Text>
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
  emptyText: { color: '#666', fontSize: 15, textAlign: 'center' },
  selectorRow: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  selectorContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1c1c1e',
  },
  tabActive: { backgroundColor: '#1c3a5e' },
  tabLabel: { color: '#888', fontSize: 13, fontWeight: '500' },
  tabLabelActive: { color: '#4a9eff', fontWeight: '700' },
  list: { paddingHorizontal: 10, paddingBottom: 20, paddingTop: 8 },
  cardWrapper: { flex: 1, margin: 6, borderRadius: 8, overflow: 'hidden' },
});
