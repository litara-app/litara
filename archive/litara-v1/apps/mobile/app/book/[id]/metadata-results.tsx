import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { metadataSearchStore } from '@/src/store/metadataSearchStore';
import type { MetadataSearchResult } from '@/src/api/books';

function formatYear(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    const y = new Date(dateStr).getFullYear();
    return isNaN(y) ? null : String(y);
  } catch {
    return null;
  }
}

interface ResultCardProps {
  item: MetadataSearchResult;
  onPress: () => void;
}

function ResultCard({ item, onPress }: ResultCardProps) {
  const { result, providerLabel } = item;
  const year = formatYear(result.publishedDate);
  const authors = result.authors?.join(', ');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      {result.coverUrl ? (
        <Image
          source={{ uri: result.coverUrl }}
          style={styles.cardCover}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.cardCover, styles.cardCoverPlaceholder]}>
          <Ionicons name="book-outline" size={24} color="#444" />
        </View>
      )}
      <View style={styles.cardInfo}>
        <View style={styles.providerBadge}>
          <Text style={styles.providerBadgeText}>{providerLabel}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {result.title ?? '(No title)'}
        </Text>
        {authors ? (
          <Text style={styles.cardAuthors} numberOfLines={1}>
            {authors}
          </Text>
        ) : null}
        {year || result.seriesName ? (
          <Text style={styles.cardMeta} numberOfLines={1}>
            {[year, result.seriesName].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#444" />
    </Pressable>
  );
}

export default function MetadataResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const results = metadataSearchStore.getResults();

  const handleSelect = (item: MetadataSearchResult) => {
    metadataSearchStore.setSelected(item);
    router.push(`/book/${id}/metadata-compare` as never);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>
          {results.length} Result{results.length !== 1 ? 's' : ''}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {results.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={48} color="#333" />
          <Text style={styles.emptyTitle}>No results found</Text>
          <Text style={styles.emptySubtitle}>
            Try adjusting your search terms or selecting different providers.
          </Text>
          <Pressable style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>Adjust search</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {results.map((item, i) => (
            <ResultCard
              key={`${item.provider}-${i}`}
              item={item}
              onPress={() => handleSelect(item)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  backBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  scroll: { paddingVertical: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  cardPressed: { backgroundColor: '#111' },
  cardCover: {
    width: 52,
    height: 78,
    borderRadius: 4,
    flexShrink: 0,
  },
  cardCoverPlaceholder: {
    backgroundColor: '#1c1c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: { flex: 1, gap: 4 },
  providerBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a2f4a',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  providerBadgeText: {
    color: '#4a9eff',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '600', lineHeight: 19 },
  cardAuthors: { color: '#4a9eff', fontSize: 12 },
  cardMeta: { color: '#666', fontSize: 12 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptySubtitle: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  backLink: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1c1c2e',
    borderRadius: 8,
  },
  backLinkText: { color: '#4a9eff', fontSize: 14, fontWeight: '600' },
});
