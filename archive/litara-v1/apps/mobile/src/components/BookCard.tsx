import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import type { BookSummary } from '@/src/api/books';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

const FORMAT_COLORS: Record<string, string> = {
  EPUB: '#2f9e44',
  MOBI: '#1971c2',
  AZW: '#e8590c',
  AZW3: '#e67700',
  CBZ: '#7048e8',
  PDF: '#c92a2a',
};

interface BookCardProps {
  book: BookSummary;
}

export function BookCard({ book }: BookCardProps) {
  const baseUrl = serverUrlStore.get();
  const token = tokenStore.get();

  const coverSource =
    book.hasCover && baseUrl
      ? {
          uri: `${baseUrl}/api/v1/books/${book.id}/cover`,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      : require('@/assets/images/icon.png');

  const authors = book.authors.join(', ');
  const progress = book.readingProgress ?? 0;

  return (
    <View style={styles.card}>
      <Image
        source={coverSource}
        style={styles.cover}
        contentFit="cover"
        transition={200}
      />
      {(book.formats.length > 0 || book.hasAudiobook) && (
        <View style={styles.formatBadges}>
          {book.formats.map((fmt) => (
            <View
              key={fmt}
              style={[
                styles.formatBadge,
                { backgroundColor: FORMAT_COLORS[fmt] ?? '#555' },
              ]}
            >
              <Text style={styles.formatBadgeText}>{fmt}</Text>
            </View>
          ))}
          {book.hasAudiobook && (
            <View style={[styles.formatBadge, { backgroundColor: '#0ca678' }]}>
              <Text style={styles.formatBadgeText}>Audio</Text>
            </View>
          )}
        </View>
      )}
      {progress > 0 && (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%` as `${number}%` },
            ]}
          />
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        {authors ? (
          <Text style={styles.authors} numberOfLines={1}>
            {authors}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
    overflow: 'hidden',
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#333',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#4a9eff',
  },
  formatBadges: {
    position: 'absolute',
    top: 6,
    left: 0,
    flexDirection: 'column',
    gap: 2,
  },
  formatBadge: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  formatBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  info: {
    padding: 8,
  },
  title: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  authors: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
});
