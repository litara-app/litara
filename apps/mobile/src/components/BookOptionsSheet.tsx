import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookSummary } from '@/src/api/books';
import { resetReadingProgress } from '@/src/api/books';
import { getRecipientEmails, sendBook } from '@/src/api/mail';
import {
  addToQueue,
  getReadingQueue,
  removeFromQueue,
} from '@/src/api/reading-queue';
import type { RecipientEmail } from '@/src/api/mail';
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
  loading?: boolean;
}

function Option({ icon, label, onPress, destructive, loading }: OptionProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color="#4a9eff"
          style={styles.optionIcon}
        />
      ) : (
        <Ionicons
          name={icon}
          size={20}
          color={destructive ? '#ff6b6b' : '#ccc'}
          style={styles.optionIcon}
        />
      )}
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
  const [mode, setMode] = useState<'main' | 'pick-email'>('main');
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [togglingQueue, setTogglingQueue] = useState(false);
  const queryClient = useQueryClient();

  // Reset to main mode whenever the sheet opens/closes
  useEffect(() => {
    if (!book) setMode('main');
  }, [book]);

  const { data: recipientEmails = [] } = useQuery({
    queryKey: ['recipient-emails'],
    queryFn: getRecipientEmails,
    enabled: !!book,
  });

  const { data: queue = [] } = useQuery({
    queryKey: ['reading-queue'],
    queryFn: getReadingQueue,
    enabled: !!book,
  });

  const isInQueue = book
    ? queue.some((item) => item.bookId === book.id)
    : false;

  const handleToggleQueue = async () => {
    if (!book) return;
    setTogglingQueue(true);
    try {
      if (isInQueue) {
        queryClient.setQueryData(
          ['reading-queue'],
          queue.filter((item) => item.bookId !== book.id),
        );
        await removeFromQueue(book.id);
      } else {
        await addToQueue(book.id);
        await queryClient.invalidateQueries({ queryKey: ['reading-queue'] });
      }
    } catch {
      await queryClient.invalidateQueries({ queryKey: ['reading-queue'] });
    } finally {
      setTogglingQueue(false);
    }
  };

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

  const handleResetProgress = () => {
    Alert.alert(
      'Reset Reading Progress',
      'This will clear all reading progress for this book, including KOReader sync data and in-app progress.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              await resetReadingProgress(book.id);
              await queryClient.invalidateQueries({ queryKey: ['books'] });
              onClose();
            } catch {
              Alert.alert('Error', 'Failed to reset reading progress.');
            } finally {
              setResetting(false);
            }
          },
        },
      ],
    );
  };

  const handleSendEmail = () => {
    if (recipientEmails.length === 0) {
      Alert.alert(
        'No recipient email',
        'Add a recipient email address in your account settings before sending books.',
      );
      return;
    }
    if (recipientEmails.length === 1) {
      doSend(recipientEmails[0].id);
    } else {
      setMode('pick-email');
    }
  };

  const doSend = async (recipientEmailId: string) => {
    setSending(true);
    try {
      await sendBook(book.id, { recipientEmailId });
      Alert.alert('Sent', 'Book sent successfully.');
      onClose();
    } catch {
      Alert.alert(
        'Send failed',
        'Could not send the book. Check your email settings.',
      );
    } finally {
      setSending(false);
      setMode('main');
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop — tap to dismiss */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.sheet}>
        {/* Drag handle */}
        <View style={styles.handle} />

        {mode === 'main' && (
          <>
            {/* Book header */}
            <View style={styles.bookRow}>
              <Image
                source={coverSource}
                style={styles.cover}
                contentFit="cover"
              />
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

            <Option
              icon="mail-outline"
              label="Send to Email"
              onPress={handleSendEmail}
              loading={sending}
            />

            <Option
              icon={isInQueue ? 'checkmark-circle-outline' : 'list-outline'}
              label={isInQueue ? 'Remove from Queue' : 'Add to Queue'}
              onPress={handleToggleQueue}
              loading={togglingQueue}
            />

            {book.readingProgress != null && book.readingProgress > 0 && (
              <Option
                icon="refresh-outline"
                label="Reset Progress"
                onPress={handleResetProgress}
                destructive
                loading={resetting}
              />
            )}
          </>
        )}

        {mode === 'pick-email' && (
          <>
            <Pressable style={styles.backRow} onPress={() => setMode('main')}>
              <Ionicons name="chevron-back" size={18} color="#4a9eff" />
              <Text style={styles.backText}>Back</Text>
            </Pressable>

            <Text style={styles.pickerTitle}>Send to</Text>
            <View style={styles.divider} />

            {recipientEmails.map((re: RecipientEmail) => (
              <Pressable
                key={re.id}
                style={({ pressed }) => [
                  styles.emailRow,
                  pressed && styles.optionPressed,
                ]}
                onPress={() => doSend(re.id)}
                disabled={sending}
              >
                <View style={styles.emailRowContent}>
                  <Text style={styles.emailAddress}>{re.email}</Text>
                  {re.label && (
                    <Text style={styles.emailLabel}>{re.label}</Text>
                  )}
                </View>
                {re.isDefault && (
                  <Text style={styles.defaultBadge}>Default</Text>
                )}
                {sending ? (
                  <ActivityIndicator size="small" color="#4a9eff" />
                ) : (
                  <Ionicons name="send-outline" size={18} color="#4a9eff" />
                )}
              </Pressable>
            ))}
          </>
        )}
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
  optionIcon: {
    width: 20,
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
  // Back row
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  backText: {
    color: '#4a9eff',
    fontSize: 15,
  },
  pickerTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  // Email rows
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  emailRowContent: {
    flex: 1,
    gap: 2,
  },
  emailAddress: {
    color: '#fff',
    fontSize: 15,
  },
  emailLabel: {
    color: '#888',
    fontSize: 12,
  },
  defaultBadge: {
    color: '#4a9eff',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
