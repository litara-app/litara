import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import type { BookSummary } from '@/src/api/books';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

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
