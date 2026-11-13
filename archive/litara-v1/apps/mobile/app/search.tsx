import { useEffect, useRef, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookCard } from '@/src/components/BookCard';
import { BookOptionsSheet } from '@/src/components/BookOptionsSheet';
import { getBooks } from '@/src/api/books';
import type { BookSummary } from '@/src/api/books';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);

  // Auto-focus on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading } = useQuery({
    queryKey: ['books', 'search', debouncedQuery],
    queryFn: () => getBooks({ q: debouncedQuery, limit: 40 }),
    enabled: debouncedQuery.length > 1,
  });

  const results = data ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Search bar row */}
      <View style={styles.bar}>
        <View style={styles.inputWrapper}>
          <Ionicons
            name="search"
            size={17}
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
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      {/* Results */}
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
          data={results}
          keyExtractor={(item) => item.id}
          numColumns={2}
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
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
  },
  inputIcon: {
    marginRight: 6,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
  },
  cancel: {
    color: '#4a9eff',
    fontSize: 15,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 60,
  },
  hint: {
    color: '#444',
    fontSize: 15,
  },
  noResults: {
    color: '#666',
    fontSize: 15,
  },
  list: {
    paddingHorizontal: 10,
    paddingBottom: 20,
    paddingTop: 4,
  },
  cardWrapper: {
    flex: 1,
    margin: 6,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
