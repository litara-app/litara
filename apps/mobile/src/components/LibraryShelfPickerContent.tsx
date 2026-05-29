import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBookDetail, updateBookShelves } from '@/src/api/books';
import { getShelves } from '@/src/api/shelves';

interface LibraryShelfPickerContentProps {
  bookId: string;
  onBack: () => void;
  onSaved?: () => void;
}

export function LibraryShelfPickerContent({
  bookId,
  onBack,
  onSaved,
}: LibraryShelfPickerContentProps) {
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [selectedShelfIds, setSelectedShelfIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data: book, isLoading: bookLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => getBookDetail(bookId),
  });

  const { data: shelves = [], isLoading: shelvesLoading } = useQuery({
    queryKey: ['shelves'],
    queryFn: getShelves,
  });

  useEffect(() => {
    if (book && !initialized) {
      setSelectedShelfIds(book.shelves.map((s) => s.id));
      setInitialized(true);
    }
  }, [book, initialized]);

  const isLoading = bookLoading || shelvesLoading || !initialized;

  const nonSmartShelves = shelves.filter((s) => !s.isSmart);

  const handleShelfToggle = (id: string) => {
    setSelectedShelfIds((prev) =>
      prev.includes(id) ? prev.filter((sid) => sid !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateBookShelves(bookId, selectedShelfIds);
      await queryClient.invalidateQueries({ queryKey: ['book', bookId] });
      await queryClient.invalidateQueries({ queryKey: ['books'] });
      onSaved?.();
      onBack();
    } catch {
      Alert.alert('Error', 'Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
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
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
      >
        {nonSmartShelves.length === 0 ? (
          <Text style={styles.emptyText}>No shelves available.</Text>
        ) : (
          nonSmartShelves.map((shelf) => {
            const checked = selectedShelfIds.includes(shelf.id);
            return (
              <Pressable
                key={shelf.id}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => handleShelfToggle(shelf.id)}
              >
                <Text style={styles.rowText}>{shelf.name}</Text>
                {checked && (
                  <Ionicons name="checkmark" size={20} color="#4a9eff" />
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Pressable
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#000" />
        ) : (
          <Text style={styles.saveBtnText}>Save</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 160,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#2c2c2e',
  },
  tabActive: { backgroundColor: '#4a9eff' },
  tabText: { color: '#888', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#000' },
  list: { maxHeight: 280 },
  listContent: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2c2c2e',
  },
  rowPressed: { opacity: 0.6 },
  rowText: { color: '#fff', fontSize: 15 },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  saveBtn: {
    backgroundColor: '#4a9eff',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
