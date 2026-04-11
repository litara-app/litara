import { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { getAuthorDetail } from '@/src/api/authors';
import type { AuthorBook } from '@/src/api/authors';
import { serverUrlStore } from '@/src/auth/serverUrlStore';

function photoSource(authorId: string) {
  const base = serverUrlStore.get();
  return base ? { uri: `${base}/api/v1/authors/${authorId}/photo` } : null;
}

function coverSource(bookId: string, coverUpdatedAt: string) {
  const base = serverUrlStore.get();
  return base
    ? { uri: `${base}/api/v1/books/${bookId}/cover?t=${coverUpdatedAt}` }
    : null;
}

function AuthorHeader({
  id,
  hasCover,
  biography,
  goodreadsId,
}: {
  id: string;
  hasCover: boolean;
  biography: string | null;
  goodreadsId: string | null;
}) {
  const src = hasCover ? photoSource(id) : null;

  return (
    <View style={styles.header}>
      {src ? (
        <Image
          source={src}
          style={styles.headerPhoto}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={[styles.headerPhoto, styles.headerPhotoPlaceholder]}>
          <Ionicons name="person-outline" size={40} color="#444" />
        </View>
      )}

      <Text style={styles.biography}>
        {biography ?? 'No biography available.'}
      </Text>

      {goodreadsId && (
        <Pressable
          style={({ pressed }) => [
            styles.goodreadsBtn,
            pressed && styles.goodreadsBtnPressed,
          ]}
          onPress={() =>
            void Linking.openURL(
              `https://www.goodreads.com/author/show/${goodreadsId}`,
            )
          }
        >
          <Ionicons name="open-outline" size={14} color="#4a9eff" />
          <Text style={styles.goodreadsBtnText}>View on Goodreads</Text>
        </Pressable>
      )}

      <View style={styles.booksHeader}>
        <Text style={styles.booksHeaderText}>Books</Text>
      </View>
    </View>
  );
}

function BookRow({ book }: { book: AuthorBook }) {
  const src = book.hasCover ? coverSource(book.id, book.coverUpdatedAt) : null;

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
      {src ? (
        <Image
          source={src}
          style={styles.bookCover}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={[styles.bookCover, styles.bookCoverPlaceholder]}>
          <Ionicons name="book-outline" size={16} color="#444" />
        </View>
      )}

      <View style={styles.bookInfo}>
        <Text style={styles.bookTitle} numberOfLines={2}>
          {book.title}
        </Text>
        {book.formats.length > 0 && (
          <Text style={styles.bookFormats} numberOfLines={1}>
            {[...new Set(book.formats)].join(' · ').toUpperCase()}
          </Text>
        )}
      </View>

      <Ionicons name="chevron-forward" size={14} color="#444" />
    </Pressable>
  );
}

export default function AuthorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();

  const { data: author, isLoading } = useQuery({
    queryKey: ['author-detail', id],
    queryFn: () => getAuthorDetail(id),
    enabled: !!id,
  });

  useEffect(() => {
    if (author) {
      navigation.setOptions({ title: author.name });
    }
  }, [navigation, author]);

  if (isLoading || !author) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  return (
    <FlatList<AuthorBook>
      style={styles.container}
      data={author.books}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <AuthorHeader
          id={author.id}
          hasCover={author.hasCover}
          biography={author.biography}
          goodreadsId={author.goodreadsId}
        />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => <BookRow book={item} />}
      contentContainerStyle={styles.list}
    />
  );
}

const PHOTO_SIZE = 96;
const COVER_W = 44;
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
    paddingBottom: 8,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  headerPhoto: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
    backgroundColor: '#1c1c1e',
    alignSelf: 'center',
  },
  headerPhotoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  biography: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  goodreadsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  goodreadsBtnPressed: { opacity: 0.6 },
  goodreadsBtnText: {
    color: '#4a9eff',
    fontSize: 14,
  },
  booksHeader: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  booksHeaderText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Book rows
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  bookRowPressed: { backgroundColor: '#ffffff08' },
  bookCover: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: 4,
    backgroundColor: '#1c1c1e',
    flexShrink: 0,
  },
  bookCoverPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookInfo: { flex: 1 },
  bookTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  bookFormats: {
    color: '#555',
    fontSize: 11,
    marginTop: 3,
  },

  separator: {
    height: 1,
    backgroundColor: '#1c1c1e',
    marginLeft: 16 + COVER_W + 12,
  },
});
