import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { BookSummary } from '@/src/api/books';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

interface BookOptionsSheetProps {
  book: BookSummary | null;
  onClose: () => void;
}

interface OptionProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

function Option({ icon, label, onPress, destructive }: OptionProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={20}
        color={destructive ? '#ff6b6b' : '#ccc'}
      />
      <Text
        style={[
          styles.optionLabel,
          destructive && styles.optionLabelDestructive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BookOptionsSheet({ book, onClose }: BookOptionsSheetProps) {
  if (!book) return null;

  const baseUrl = serverUrlStore.get();
  const token = tokenStore.get();
  const coverSource =
    book.hasCover && baseUrl
      ? {
          uri: `${baseUrl}/api/v1/books/${book.id}/cover`,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      : require('@/assets/images/icon.png');

  const handleDetails = () => {
    onClose();
    router.push({ pathname: '/book/[id]', params: { id: book.id } });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop — tap to dismiss */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.sheet}>
        {/* Drag handle */}
        <View style={styles.handle} />

        {/* Book header */}
        <View style={styles.bookRow}>
          <Image source={coverSource} style={styles.cover} contentFit="cover" />
          <View style={styles.bookMeta}>
            <Text style={styles.bookTitle} numberOfLines={2}>
              {book.title}
            </Text>
            {book.authors.length > 0 && (
              <Text style={styles.bookAuthors} numberOfLines={1}>
                {book.authors.join(', ')}
              </Text>
            )}
            {book.formats.length > 0 && (
              <Text style={styles.bookFormat}>{book.formats[0]}</Text>
            )}
          </View>
        </View>

        <View style={styles.divider} />

        <Option
          icon="information-circle-outline"
          label="View Details"
          onPress={handleDetails}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#00000088',
  },
  sheet: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  bookRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  cover: {
    width: 56,
    height: 84,
    borderRadius: 4,
  },
  bookMeta: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  bookTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  bookAuthors: {
    color: '#999',
    fontSize: 13,
  },
  bookFormat: {
    color: '#555',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: '#2c2c2e',
    marginBottom: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  optionPressed: {
    opacity: 0.6,
  },
  optionLabel: {
    color: '#fff',
    fontSize: 16,
  },
  optionLabelDestructive: {
    color: '#ff6b6b',
  },
});
