import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useAuthContext } from '@/src/context/AuthContext';

interface PendingBook {
  id: string;
  status: 'PENDING' | 'COLLISION';
  originalFilename: string;
  title: string | null;
  authors: string;
  seriesName: string | null;
  seriesPosition: number | null;
  collidingPath: string | null;
  targetPath: string | null;
}

function parseAuthors(raw: string): string {
  try {
    return (JSON.parse(raw) as string[]).join(', ');
  } catch {
    return raw;
  }
}

function BookCard({
  book,
  onRefresh,
}: {
  book: PendingBook;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleApprove() {
    setLoading(true);
    try {
      await api.post(`/book-drop/${book.id}/approve`);
      onRefresh();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? 'Approval failed.';
      Alert.alert('Error', msg);
      onRefresh(); // may have become COLLISION
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveOverwrite() {
    Alert.alert(
      'Confirm Overwrite',
      `This will overwrite the existing file at:\n${book.collidingPath ?? ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Overwrite',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await api.post(`/book-drop/${book.id}/approve-overwrite`);
              onRefresh();
            } catch (err: unknown) {
              const msg =
                (err as { response?: { data?: { message?: string } } }).response
                  ?.data?.message ?? 'Overwrite failed.';
              Alert.alert('Error', msg);
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }

  async function handleReject() {
    setLoading(true);
    try {
      await api.post(`/book-drop/${book.id}/reject`);
      onRefresh();
    } catch {
      Alert.alert('Error', 'Rejection failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {book.title ?? book.originalFilename}
        </Text>
        <View
          style={[
            styles.badge,
            book.status === 'COLLISION' ? styles.badgeOrange : styles.badgeBlue,
          ]}
        >
          <Text style={styles.badgeText}>{book.status}</Text>
        </View>
      </View>

      <Text style={styles.cardMeta}>
        {parseAuthors(book.authors) || 'Unknown author'}
        {book.seriesName
          ? ` · ${book.seriesName}${book.seriesPosition ? ` #${book.seriesPosition}` : ''}`
          : ''}
      </Text>
      <Text style={styles.cardFilename}>{book.originalFilename}</Text>

      {book.status === 'COLLISION' && (
        <View style={styles.collisionWarning}>
          <Ionicons name="warning-outline" size={14} color="#f0a500" />
          <Text style={styles.collisionText} numberOfLines={2}>
            Collision: {book.collidingPath}
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color="#4a9eff" style={{ marginTop: 8 }} />
      ) : (
        <View style={styles.actions}>
          {book.status === 'PENDING' && (
            <Pressable
              style={[styles.btn, styles.btnApprove]}
              onPress={() => void handleApprove()}
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.btnText}>Approve</Text>
            </Pressable>
          )}
          {book.status === 'COLLISION' && (
            <Pressable
              style={[styles.btn, styles.btnOverwrite]}
              onPress={() => void handleApproveOverwrite()}
            >
              <Ionicons name="warning" size={16} color="#fff" />
              <Text style={styles.btnText}>Approve Overwrite</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.btn, styles.btnReject]}
            onPress={() => void handleReject()}
          >
            <Ionicons name="close" size={16} color="#fff" />
            <Text style={styles.btnText}>Reject</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function BookReviewScreen() {
  const { user } = useAuthContext();
  const [books, setBooks] = useState<PendingBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PendingBook[]>('/book-drop/pending');
      setBooks(res.data);
    } catch {
      // non-admin will get 403 — show nothing
      setBooks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (user?.role !== 'ADMIN') {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Admin access required.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#4a9eff" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor="#4a9eff"
        />
      }
    >
      <Text style={styles.heading}>Book Review</Text>
      <Text style={styles.subheading}>
        Approve or reject books submitted via the book drop.
      </Text>

      {books.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No books pending review.</Text>
        </View>
      ) : (
        books.map((book) => (
          <BookCard key={book.id} book={book} onRefresh={() => void load()} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 16, gap: 12 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  heading: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subheading: { color: '#888', fontSize: 14 },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { color: '#fff', fontWeight: '600', flex: 1, fontSize: 15 },
  cardMeta: { color: '#888', fontSize: 13 },
  cardFilename: { color: '#555', fontSize: 11 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeBlue: { backgroundColor: '#1a3a5a' },
  badgeOrange: { backgroundColor: '#5a3a00' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  collisionWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#2a1a00',
    padding: 8,
    borderRadius: 6,
  },
  collisionText: { color: '#f0a500', fontSize: 12, flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  btnApprove: { backgroundColor: '#1a5a2a' },
  btnOverwrite: { backgroundColor: '#7a4a00' },
  btnReject: { backgroundColor: '#5a1a1a' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  emptyCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: { color: '#555', fontSize: 14 },
});
