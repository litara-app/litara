import { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { getSeriesDetail } from '@/src/api/series';
import type { SeriesBookItem, SeriesDetail } from '@/src/api/series';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

function coverSource(bookId: string, coverUpdatedAt: string) {
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

function formatSequence(seq: number | null): string {
  if (seq == null) return '—';
  return Number.isInteger(seq) ? `#${seq}` : `#${seq}`;
}

function formatYear(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).getFullYear().toString();
  } catch {
    return null;
  }
}

function SeriesHeader({ series }: { series: SeriesDetail }) {
  const bookLabel =
    series.totalBooks != null
      ? `${series.books.length} / ${series.totalBooks} books`
      : `${series.books.length} book${series.books.length !== 1 ? 's' : ''}`;

  return (
    <View style={styles.header}>
      <Text style={styles.headerName}>{series.name}</Text>
      {series.authors.length > 0 && (
        <Text style={styles.headerAuthors}>{series.authors.join(', ')}</Text>
      )}
      <Text style={styles.headerCount}>{bookLabel}</Text>
    </View>
  );
}

function BookRow({ book }: { book: SeriesBookItem }) {
  const year = formatYear(book.publishedDate);
  const formats = [...new Set(book.formats)].join(' · ').toUpperCase();
  const src = book.hasCover
    ? coverSource(book.id, book.coverUpdatedAt)
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
      {/* Sequence badge */}
      <View style={styles.seqBadge}>
        <Text style={styles.seqText}>{formatSequence(book.sequence)}</Text>
      </View>

      {/* Cover */}
      <Image
        source={src}
        style={styles.bookCover}
        contentFit="cover"
        transition={200}
      />

      {/* Info */}
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

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();

  const { data: series, isLoading } = useQuery({
    queryKey: ['series-detail', id],
    queryFn: () => getSeriesDetail(id),
    enabled: !!id,
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

  return (
    <FlatList<SeriesBookItem>
      style={styles.container}
      data={series.books}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<SeriesHeader series={series} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => <BookRow book={item} />}
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

  // Book row
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  bookRowPressed: { backgroundColor: '#ffffff08' },

  seqBadge: {
    width: 36,
    alignItems: 'center',
  },
  seqText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '600',
  },

  bookCover: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: 4,
    backgroundColor: '#1c1c1e',
  },

  bookInfo: { flex: 1 },
  bookTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  bookMeta: {
    color: '#888',
    fontSize: 12,
    marginTop: 3,
  },
  bookPages: {
    color: '#555',
    fontSize: 11,
    marginTop: 2,
  },

  separator: {
    height: 1,
    backgroundColor: '#1c1c1e',
    marginLeft: 16 + 36 + 12 + COVER_W + 12, // align with book title
  },
});
