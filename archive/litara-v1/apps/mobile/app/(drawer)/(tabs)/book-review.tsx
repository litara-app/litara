import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useAuthContext } from '@/src/context/AuthContext';
import { getLibraries } from '@/src/api/libraries';
import { resolveLibraryIcon } from '@/src/utils/libraryIcons';

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
  targetLibraryId: string | null;
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
  targetLibraryId,
  targetLibraryName,
  onEditTarget,
}: {
  book: PendingBook;
  onRefresh: () => void;
  targetLibraryId: string | null;
  targetLibraryName: string | null;
  onEditTarget: () => void;
}) {
  const [loading, setLoading] = useState(false);

  // Persist the chosen target library on the pending book before approving, so
  // the server can resolve where to write it (it 400s otherwise).
  async function applyTargetLibrary(): Promise<boolean> {
    if (!targetLibraryId) {
      Alert.alert(
        'Select a library',
        'Choose a target library at the top of the screen before approving.',
      );
      return false;
    }
    if (targetLibraryId !== book.targetLibraryId) {
      await api.patch(`/book-drop/${book.id}`, { targetLibraryId });
    }
    return true;
  }

  async function handleApprove() {
    setLoading(true);
    try {
      if (!(await applyTargetLibrary())) return;
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
              if (!(await applyTargetLibrary())) return;
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

      <Pressable
        style={({ pressed }) => [
          styles.targetRow,
          pressed && styles.rowPressed,
        ]}
        onPress={onEditTarget}
      >
        <Ionicons name="folder-outline" size={13} color="#4a9eff" />
        <Text style={styles.targetText} numberOfLines={1}>
          {targetLibraryName ?? 'No library selected'}
        </Text>
        <Ionicons name="chevron-down" size={13} color="#4a9eff" />
      </Pressable>

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
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(
    null,
  );
  // Per-book target overrides (bookId -> libraryId). The top pills set the
  // default for every card; tapping a card's target row overrides just that one.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [pickerBookId, setPickerBookId] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  const { data: libraries = [] } = useQuery({
    queryKey: ['libraries'],
    queryFn: getLibraries,
    enabled: isAdmin,
  });

  // Default the target to the first library once libraries load. Approving
  // requires a target library, so pre-selecting removes a step.
  const defaultLibraryId = selectedLibraryId ?? libraries[0]?.id ?? null;

  const targetFor = (book: PendingBook): string | null =>
    overrides[book.id] ?? book.targetLibraryId ?? defaultLibraryId;
  const libraryName = (id: string | null): string | null =>
    libraries.find((l) => l.id === id)?.name ?? null;

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

  if (!isAdmin) {
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
    <View style={styles.container}>
      {libraries.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.selectorRow}
          contentContainerStyle={styles.selectorContent}
        >
          {libraries.map((lib) => {
            const active = lib.id === defaultLibraryId;
            const iconName = resolveLibraryIcon(lib.iconKey);
            return (
              <Pressable
                key={lib.id}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setSelectedLibraryId(lib.id)}
              >
                <Ionicons
                  name={iconName}
                  size={14}
                  color={active ? '#4a9eff' : '#888'}
                />
                <Text
                  style={[styles.tabLabel, active && styles.tabLabelActive]}
                >
                  {lib.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
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
          Approve or reject books submitted via the book drop. Approved books
          are written to the selected library.
        </Text>

        {books.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No books pending review.</Text>
          </View>
        ) : (
          books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onRefresh={() => void load()}
              targetLibraryId={targetFor(book)}
              targetLibraryName={libraryName(targetFor(book))}
              onEditTarget={() => setPickerBookId(book.id)}
            />
          ))
        )}
      </ScrollView>

      <Modal
        visible={pickerBookId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerBookId(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setPickerBookId(null)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Target Library</Text>
            <ScrollView style={styles.modalList}>
              {libraries.map((lib) => {
                const selected =
                  pickerBookId !== null &&
                  lib.id === (overrides[pickerBookId] ?? defaultLibraryId);
                return (
                  <Pressable
                    key={lib.id}
                    style={({ pressed }) => [
                      styles.modalRow,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => {
                      if (pickerBookId) {
                        setOverrides((prev) => ({
                          ...prev,
                          [pickerBookId]: lib.id,
                        }));
                      }
                      setPickerBookId(null);
                    }}
                  >
                    <Ionicons
                      name={resolveLibraryIcon(lib.iconKey)}
                      size={18}
                      color={selected ? '#4a9eff' : '#888'}
                    />
                    <Text
                      style={[
                        styles.modalRowText,
                        selected && styles.modalRowTextSelected,
                      ]}
                    >
                      {lib.name}
                    </Text>
                    {selected && (
                      <Ionicons name="checkmark" size={18} color="#4a9eff" />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
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
  // Library selector pills
  selectorRow: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  selectorContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1c1c1e',
  },
  tabActive: { backgroundColor: '#1c3a5e' },
  tabLabel: { color: '#888', fontSize: 13, fontWeight: '500' },
  tabLabelActive: { color: '#4a9eff', fontWeight: '700' },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#11233a',
  },
  targetText: { color: '#4a9eff', fontSize: 12, maxWidth: 200 },
  rowPressed: { opacity: 0.6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 32,
    paddingHorizontal: 16,
    maxHeight: '70%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalList: { flexGrow: 0 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2c2c2e',
  },
  modalRowText: { color: '#fff', fontSize: 15, flex: 1 },
  modalRowTextSelected: { color: '#4a9eff', fontWeight: '600' },
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
