import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAnnotations } from '@/src/api/annotations';
import type { Annotation, AnnotationType } from '@/src/api/annotations';

const TYPE_COLORS: Record<AnnotationType, string> = {
  HIGHLIGHT: '#f5c842',
  UNDERLINE: '#4a9eff',
  STRIKETHROUGH: '#ff6b6b',
  BOOKMARK: '#7c5af3',
};

const TYPE_LABELS: Record<AnnotationType, string> = {
  HIGHLIGHT: 'Highlight',
  UNDERLINE: 'Underline',
  STRIKETHROUGH: 'Strikethrough',
  BOOKMARK: 'Bookmark',
};

function AnnotationCard({ item }: { item: Annotation }) {
  const typeColor = TYPE_COLORS[item.type];
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.bookTitle} numberOfLines={1}>
          {item.book.title}
        </Text>
        <View style={[styles.typeBadge, { backgroundColor: typeColor + '22' }]}>
          <View style={[styles.typeDot, { backgroundColor: typeColor }]} />
          <Text style={[styles.typeLabel, { color: typeColor }]}>
            {TYPE_LABELS[item.type]}
          </Text>
        </View>
      </View>

      {item.color && (
        <View style={styles.colorRow}>
          <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
        </View>
      )}

      {item.text && (
        <Text style={styles.annotationText} numberOfLines={4}>
          &ldquo;{item.text}&rdquo;
        </Text>
      )}

      {item.note && (
        <Text style={styles.noteText} numberOfLines={3}>
          {item.note}
        </Text>
      )}

      <Text style={styles.dateText}>
        {new Date(item.createdAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </Text>
    </View>
  );
}

const TYPE_FILTERS: { label: string; value: AnnotationType | null }[] = [
  { label: 'All', value: null },
  { label: 'Highlights', value: 'HIGHLIGHT' },
  { label: 'Underlines', value: 'UNDERLINE' },
  { label: 'Bookmarks', value: 'BOOKMARK' },
  { label: 'Strikethrough', value: 'STRIKETHROUGH' },
];

export default function AnnotationsScreen() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AnnotationType | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const {
    data = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['annotations'],
    queryFn: () => getAnnotations(),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((a) => {
      if (typeFilter && a.type !== typeFilter) return false;
      if (!q) return true;
      return (
        a.book.title.toLowerCase().includes(q) ||
        a.text?.toLowerCase().includes(q) ||
        a.note?.toLowerCase().includes(q)
      );
    });
  }, [data, search, typeFilter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.inputWrapper}>
          <Ionicons name="search" size={16} color="#666" />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search annotations…"
            placeholderTextColor="#555"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={6}>
              <Ionicons name="close-circle" size={16} color="#555" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Type filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {TYPE_FILTERS.map((f) => {
          const active = typeFilter === f.value;
          return (
            <Pressable
              key={f.label}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setTypeFilter(f.value)}
            >
              <Text
                style={[styles.filterLabel, active && styles.filterLabelActive]}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Results */}
      {filtered.length === 0 ? (
        <View style={styles.centered}>
          {data.length === 0 ? (
            <>
              <Ionicons name="bookmark-outline" size={40} color="#2c2c2e" />
              <Text style={styles.emptyHeading}>No annotations yet</Text>
              <Text style={styles.emptySubtext}>
                Highlights and notes from your books will appear here.
              </Text>
            </>
          ) : (
            <Text style={styles.emptyText}>
              No annotations match your search.
            </Text>
          )}
        </View>
      ) : (
        <FlatList<Annotation>
          data={filtered}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#4a9eff"
            />
          }
          renderItem={({ item }) => <AnnotationCard item={item} />}
        />
      )}
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
    gap: 10,
  },
  emptyHeading: {
    color: '#ccc',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyText: { color: '#666', fontSize: 15, textAlign: 'center' },

  // Search
  searchRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    gap: 6,
  },
  input: { flex: 1, color: '#fff', fontSize: 15 },

  // Type filters
  filterScroll: { flexGrow: 0 },
  filterRow: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1c1c1e',
  },
  filterChipActive: { backgroundColor: '#1c3a5e' },
  filterLabel: { color: '#888', fontSize: 13, fontWeight: '500' },
  filterLabelActive: { color: '#4a9eff', fontWeight: '700' },

  // List
  list: { paddingHorizontal: 12, paddingBottom: 24 },

  // Card
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  bookTitle: {
    color: '#4a9eff',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  typeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  typeLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  colorRow: {
    flexDirection: 'row',
  },
  colorSwatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  annotationText: {
    color: '#ddd',
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  noteText: {
    color: '#999',
    fontSize: 13,
    lineHeight: 18,
  },
  dateText: {
    color: '#444',
    fontSize: 11,
    marginTop: 2,
  },
});
