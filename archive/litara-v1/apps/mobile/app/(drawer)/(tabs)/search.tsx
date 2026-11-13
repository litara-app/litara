import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  DrawerActions,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookCard } from '@/src/components/BookCard';
import { BookOptionsSheet } from '@/src/components/BookOptionsSheet';
import { useGridSize } from '@/src/context/GridSizeContext';
import { getBooks } from '@/src/api/books';
import type { BookSummary } from '@/src/api/books';

const GRID_ICONS: Record<number, keyof typeof Ionicons.glyphMap> = {
  2: 'grid-outline',
  3: 'apps-outline',
  4: 'grid',
};

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const { numColumns, cycleColumns } = useGridSize();

  // Focus the input every time this tab comes into view
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }, []),
  );

  // Debounce query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading } = useQuery({
    queryKey: ['books', 'search', debouncedQuery],
    queryFn: () => getBooks({ q: debouncedQuery, limit: 80 }),
    enabled: debouncedQuery.length > 1,
  });

  const results = data ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top bar — matches the standard tab header style */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          style={styles.menuBtn}
          hitSlop={8}
        >
          <Ionicons name="menu" size={24} color="#fff" />
        </Pressable>

        <View style={styles.inputWrapper}>
          <Ionicons
            name="search"
            size={16}
            color="#666"
            style={styles.inputIcon}
          />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Title, author, series…"
            placeholderTextColor="#555"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                setQuery('');
                setDebouncedQuery('');
                inputRef.current?.focus();
              }}
              hitSlop={6}
            >
              <Ionicons name="close-circle" size={16} color="#555" />
            </Pressable>
          )}
        </View>

        <Pressable onPress={cycleColumns} hitSlop={8} style={styles.gridBtn}>
          <Ionicons name={GRID_ICONS[numColumns]} size={22} color="#fff" />
        </Pressable>
      </View>

      {/* States */}
      {isLoading && debouncedQuery.length > 1 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#4a9eff" />
        </View>
      ) : debouncedQuery.length <= 1 ? (
        <View style={styles.centered}>
          <Ionicons name="search" size={40} color="#2c2c2e" />
          <Text style={styles.hint}>Search your library</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.noResults}>
            No results for &quot;{debouncedQuery}&quot;
          </Text>
        </View>
      ) : (
        <FlatList<BookSummary>
          key={numColumns}
          data={results}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
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

  // Top bar mirrors the standard tab header
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
    paddingVertical: 8,
    gap: 8,
  },
  menuBtn: {
    paddingLeft: 16,
    paddingRight: 4,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    gap: 6,
  },
  inputIcon: {},
  input: { flex: 1, color: '#fff', fontSize: 15 },
  gridBtn: {
    paddingRight: 16,
    paddingLeft: 4,
  },

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 60,
  },
  hint: { color: '#444', fontSize: 15 },
  noResults: { color: '#666', fontSize: 15 },
  list: { paddingHorizontal: 10, paddingBottom: 20, paddingTop: 4 },
  cardWrapper: { flex: 1, margin: 6, borderRadius: 8, overflow: 'hidden' },
});
