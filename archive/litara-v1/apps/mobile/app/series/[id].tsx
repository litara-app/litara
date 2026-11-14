import { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { getSeriesDetail, enrichSeries } from '@/src/api/series';
import type {
  SeriesBookItem,
  SeriesSlotItem,
  SeriesDetail,
} from '@/src/api/series';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

function bookCoverSource(bookId: string, coverUpdatedAt: string) {
  const base = serverUrlStore.get();
  return base
    ? {
        uri: `${base}/api/v1/books/${bookId}/cover?t=${coverUpdatedAt}`,
        headers: tokenStore.get()
          ? { Authorization: `Bearer ${tokenStore.get()}` }
          : undefined,
      }
    : require('@/assets/images/icon.png');
}

function slotCoverSource(slotId: string) {
  const base = serverUrlStore.get();
  return base
    ? {
        uri: `${base}/api/v1/series/slots/${slotId}/cover`,
        headers: tokenStore.get()
          ? { Authorization: `Bearer ${tokenStore.get()}` }
          : undefined,
      }
    : require('@/assets/images/icon.png');
}

function formatSequence(seq: number | null): string {
  if (seq == null) return '—';
  return `#${seq}`;
}

function formatYear(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).getFullYear().toString();
  } catch {
    return null;
  }
}

function SeriesHeader({
  series,
  libraryOnly,
  onToggleLibraryOnly,
  onEnrich,
  enriching,
}: {
  series: SeriesDetail;
  libraryOnly: boolean;
  onToggleLibraryOnly: (val: boolean) => void;
  onEnrich: () => void;
  enriching: boolean;
}) {
  const totalCount =
    series.totalBooks ?? series.books.length + series.slots.length;
  const bookLabel =
    series.slots.length > 0 || series.totalBooks != null
      ? `${series.books.length} / ${totalCount} books`
      : `${series.books.length} book${series.books.length !== 1 ? 's' : ''}`;

  return (
    <View style={styles.header}>
      <Text style={styles.headerName}>{series.name}</Text>
      {series.authors.length > 0 && (
        <Text style={styles.headerAuthors}>
          {series.authors.map((a) => a.name).join(', ')}
        </Text>
      )}
      <Text style={styles.headerCount}>{bookLabel}</Text>

      <View style={styles.headerActions}>
        <Pressable
          onPress={onEnrich}
          disabled={enriching}
          style={({ pressed }) => [
            styles.enrichButton,
            pressed && styles.enrichButtonPressed,
            enriching && styles.enrichButtonDisabled,
          ]}
        >
          <Ionicons name="refresh" size={14} color="#4a9eff" />
          <Text style={styles.enrichButtonText}>
            {enriching ? 'Fetching...' : 'Fetch Complete Series'}
          </Text>
        </Pressable>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Library only</Text>
          <Switch
            value={libraryOnly}
            onValueChange={onToggleLibraryOnly}
            trackColor={{ false: '#333', true: '#4a9eff' }}
            thumbColor="#fff"
          />
        </View>
      </View>
    </View>
  );
}

function BookRow({ book }: { book: SeriesBookItem }) {
  const year = formatYear(book.publishedDate);
  const formats = [...new Set(book.formats)].join(' · ').toUpperCase();
  const src = book.hasCover
    ? bookCoverSource(book.id, book.coverUpdatedAt)
    : require('@/assets/images/icon.png');

  return (
    <Pressable
      style={({ pressed }) => [
        styles.bookRow,
        pressed && styles.bookRowPressed,
      ]}
      onPress={() =>
        router.push({ pathname: '/book/[id]', params: { id: book.id } })
      }
      android_ripple={{ color: '#ffffff10' }}
    >
      <View style={styles.seqBadge}>
        <Text style={styles.seqText}>{formatSequence(book.sequence)}</Text>
      </View>

      <Image
        source={src}
        style={styles.bookCover}
        contentFit="cover"
        transition={200}
      />

      <View style={styles.bookInfo}>
        <Text style={styles.bookTitle} numberOfLines={2}>
          {book.title}
        </Text>
        {(year ?? formats) ? (
          <Text style={styles.bookMeta} numberOfLines={1}>
            {[year, formats].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {book.pageCount != null && (
          <Text style={styles.bookPages}>{book.pageCount} pages</Text>
        )}
      </View>

      <Ionicons name="chevron-forward" size={14} color="#444" />
    </Pressable>
  );
}

function SlotRow({ slot }: { slot: SeriesSlotItem }) {
  const src = slot.hasCover
    ? slotCoverSource(slot.id)
    : require('@/assets/images/icon.png');

  return (
    <View style={[styles.bookRow, styles.slotRow]}>
      <View style={styles.seqBadge}>
        <Text style={[styles.seqText, styles.slotSeqText]}>
          {formatSequence(slot.sequence)}
        </Text>
      </View>

      <Image
        source={src}
        style={[styles.bookCover, styles.slotCover]}
        contentFit="cover"
        transition={200}
      />

      <View style={styles.bookInfo}>
        <Text style={[styles.bookTitle, styles.slotTitle]} numberOfLines={2}>
          {slot.title}
        </Text>
        {slot.authors.length > 0 && (
          <Text style={[styles.bookMeta, styles.slotMeta]} numberOfLines={1}>
            {slot.authors.join(', ')}
          </Text>
        )}
        <Text style={styles.slotBadge}>Not in library</Text>
      </View>
    </View>
  );
}

type ListItem =
  | { kind: 'book'; data: SeriesBookItem }
  | { kind: 'slot'; data: SeriesSlotItem };

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [libraryOnly, setLibraryOnly] = useState(false);

  const { data: series, isLoading } = useQuery({
    queryKey: ['series-detail', id],
    queryFn: () => getSeriesDetail(id),
    enabled: !!id,
  });

  const enrichMutation = useMutation({
    mutationFn: () => enrichSeries(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['series-detail', id] });
    },
    onError: () => {
      Alert.alert(
        'Enrichment failed',
        'Could not fetch series data. Check that Hardcover is configured or a book in this series has a Goodreads ID.',
      );
    },
  });

  useEffect(() => {
    if (series) {
      navigation.setOptions({ title: series.name });
    }
  }, [navigation, series]);

  if (isLoading || !series) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  const items: ListItem[] = [
    ...series.books.map((b): ListItem => ({ kind: 'book', data: b })),
    ...(libraryOnly
      ? []
      : series.slots.map((s): ListItem => ({ kind: 'slot', data: s }))),
  ].sort((a, b) => {
    const seqA = a.data.sequence ?? Infinity;
    const seqB = b.data.sequence ?? Infinity;
    return seqA - seqB;
  });

  return (
    <FlatList<ListItem>
      style={styles.container}
      data={items}
      keyExtractor={(item) => `${item.kind}-${item.data.id}`}
      ListHeaderComponent={
        <SeriesHeader
          series={series}
          libraryOnly={libraryOnly}
          onToggleLibraryOnly={setLibraryOnly}
          onEnrich={() => enrichMutation.mutate()}
          enriching={enrichMutation.isPending}
        />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) =>
        item.kind === 'book' ? (
          <BookRow book={item.data} />
        ) : (
          <SlotRow slot={item.data} />
        )
      }
      contentContainerStyle={styles.list}
    />
  );
}

const COVER_W = 52;
const COVER_H = (COVER_W * 3) / 2;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { paddingBottom: 32 },
  centered: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
    gap: 4,
  },
  headerName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  headerAuthors: {
    color: '#888',
    fontSize: 14,
    marginTop: 2,
  },
  headerCount: {
    color: '#4a9eff',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  enrichButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#1c2a3a',
  },
  enrichButtonPressed: { opacity: 0.7 },
  enrichButtonDisabled: { opacity: 0.5 },
  enrichButtonText: {
    color: '#4a9eff',
    fontSize: 12,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleLabel: {
    color: '#888',
    fontSize: 13,
  },

  // Book row
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  bookRowPressed: { backgroundColor: '#ffffff08' },

  // Slot row (ghost — not in library)
  slotRow: { opacity: 0.45 },

  seqBadge: {
    width: 36,
    alignItems: 'center',
  },
  seqText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '600',
  },
  slotSeqText: { color: '#444' },

  bookCover: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: 4,
    backgroundColor: '#1c1c1e',
  },
  slotCover: { backgroundColor: '#111' },

  bookInfo: { flex: 1 },
  bookTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  slotTitle: { color: '#aaa' },
  bookMeta: {
    color: '#888',
    fontSize: 12,
    marginTop: 3,
  },
  slotMeta: { color: '#666' },
  bookPages: {
    color: '#555',
    fontSize: 11,
    marginTop: 2,
  },
  slotBadge: {
    color: '#555',
    fontSize: 10,
    marginTop: 3,
    fontStyle: 'italic',
  },

  separator: {
    height: 1,
    backgroundColor: '#1c1c1e',
    marginLeft: 16 + 36 + 12 + COVER_W + 12,
  },
});
