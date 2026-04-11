import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { useQueryClient } from '@tanstack/react-query';
import {
  getBookDetail,
  getReadingProgress,
  resetReadingProgress,
} from '@/src/api/books';
import { getRecipientEmails, sendBook } from '@/src/api/mail';
import type { RecipientEmail } from '@/src/api/mail';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

function formatBytes(bytes: string): string {
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).getFullYear().toString();
  } catch {
    return null;
  }
}

interface MetaRowProps {
  label: string;
  value: string;
}

function MetaRow({ label, value }: MetaRowProps) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

interface EmailPickerModalProps {
  visible: boolean;
  emails: RecipientEmail[];
  sending: boolean;
  onSelect: (emailId: string) => void;
  onClose: () => void;
}

function EmailPickerModal({
  visible,
  emails,
  sending,
  onSelect,
  onClose,
}: EmailPickerModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.pickerBackdrop} onPress={onClose} />
      <View style={styles.pickerSheet}>
        <View style={styles.pickerHandle} />
        <Text style={styles.pickerTitle}>Send to</Text>
        <View style={styles.pickerDivider} />
        {emails.map((re) => (
          <Pressable
            key={re.id}
            style={({ pressed }) => [
              styles.emailRow,
              pressed && styles.emailRowPressed,
            ]}
            onPress={() => onSelect(re.id)}
            disabled={sending}
          >
            <View style={styles.emailRowContent}>
              <Text style={styles.emailAddress}>{re.email}</Text>
              {re.label && <Text style={styles.emailLabel}>{re.label}</Text>}
            </View>
            {re.isDefault && <Text style={styles.defaultBadge}>Default</Text>}
            {sending ? (
              <ActivityIndicator size="small" color="#4a9eff" />
            ) : (
              <Ionicons name="send-outline" size={18} color="#4a9eff" />
            )}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pendingSendFileId, setPendingSendFileId] = useState<string | null>(
    null,
  );
  const [showEmailPicker, setShowEmailPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [resettingProgress, setResettingProgress] = useState(false);
  const queryClient = useQueryClient();

  const serverUrl = serverUrlStore.get() ?? '';
  const token = tokenStore.get() ?? '';

  const {
    data: book,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['book', id],
    queryFn: () => getBookDetail(id),
    enabled: !!id,
  });

  const { data: recipientEmails = [] } = useQuery({
    queryKey: ['recipient-emails'],
    queryFn: getRecipientEmails,
    enabled: !!id,
  });

  const { data: readingProgress, refetch: refetchProgress } = useQuery({
    queryKey: ['book-progress', id],
    queryFn: () => getReadingProgress(id),
    enabled: !!id,
  });

  const coverSource =
    book?.hasCover && serverUrl
      ? {
          uri: `${serverUrl}/api/v1/books/${id}/cover`,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      : require('@/assets/images/icon.png');

  const handleDownload = async (fileId: string, format: string) => {
    setDownloadingId(fileId);
    try {
      const url = `${serverUrl}/api/v1/books/${id}/files/${fileId}/download`;
      const safeName = (book?.title ?? id)
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .trim();
      const filename = `${safeName}.${format.toLowerCase()}`;
      const dest = `${FileSystem.documentDirectory}${filename}`;

      await FileSystem.downloadAsync(url, dest, {
        headers: { Authorization: `Bearer ${token}` },
      });

      Alert.alert('Downloaded', `"${filename}" has been saved to your device.`);
    } catch {
      Alert.alert(
        'Download failed',
        'Could not download the file. Please try again.',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleSendPress = (fileId: string) => {
    if (recipientEmails.length === 0) {
      Alert.alert(
        'No recipient email',
        'Add a recipient email address in your account settings before sending books.',
      );
      return;
    }
    if (recipientEmails.length === 1) {
      doSend(fileId, recipientEmails[0].id);
    } else {
      setPendingSendFileId(fileId);
      setShowEmailPicker(true);
    }
  };

  const doSend = async (fileId: string, recipientEmailId: string) => {
    setShowEmailPicker(false);
    setSending(true);
    setPendingSendFileId(fileId);
    try {
      await sendBook(id, { fileId, recipientEmailId });
      Alert.alert('Sent', 'Book sent successfully.');
    } catch {
      Alert.alert(
        'Send failed',
        'Could not send the book. Check your email settings.',
      );
    } finally {
      setSending(false);
      setPendingSendFileId(null);
    }
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
            setResettingProgress(true);
            try {
              await resetReadingProgress(id);
              await refetchProgress();
              await queryClient.invalidateQueries({ queryKey: ['books'] });
            } catch {
              Alert.alert('Error', 'Failed to reset reading progress.');
            } finally {
              setResettingProgress(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {book?.title ?? 'Book Details'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {isLoading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4a9eff" />
        </View>
      )}

      {isError && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load book details</Text>
          <Pressable style={styles.retryBtn} onPress={() => router.back()}>
            <Text style={styles.retryText}>Go back</Text>
          </Pressable>
        </View>
      )}

      {book && (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Cover + basic info */}
          <View style={styles.heroSection}>
            <Image
              source={coverSource}
              style={styles.cover}
              contentFit="cover"
            />
            <View style={styles.heroInfo}>
              <Text style={styles.title}>{book.title}</Text>
              {book.subtitle && (
                <Text style={styles.subtitle}>{book.subtitle}</Text>
              )}
              {book.authors.length > 0 && (
                <Text style={styles.authors}>{book.authors.join(', ')}</Text>
              )}
              {book.series && (
                <Text style={styles.series}>
                  {book.series.name}
                  {book.series.sequence != null
                    ? ` #${book.series.sequence}`
                    : ''}
                </Text>
              )}
            </View>
          </View>

          {/* Reading Progress */}
          {readingProgress != null && readingProgress.percentage > 0 && (
            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Text style={styles.sectionTitle}>Reading Progress</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.resetBtn,
                    pressed && styles.resetBtnPressed,
                  ]}
                  onPress={handleResetProgress}
                  disabled={resettingProgress}
                >
                  {resettingProgress ? (
                    <ActivityIndicator size="small" color="#ff6b6b" />
                  ) : (
                    <Text style={styles.resetBtnText}>Reset</Text>
                  )}
                </Pressable>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width:
                        `${readingProgress.percentage * 100}%` as `${number}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {Math.round(readingProgress.percentage * 100)}% read
              </Text>
            </View>
          )}

          {/* Description */}
          {book.description && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{book.description}</Text>
            </View>
          )}

          {/* Metadata */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details</Text>
            <View style={styles.metaContainer}>
              {book.pageCount != null && (
                <MetaRow label="Pages" value={book.pageCount.toString()} />
              )}
              {book.language && (
                <MetaRow label="Language" value={book.language.toUpperCase()} />
              )}
              {book.publisher && (
                <MetaRow label="Publisher" value={book.publisher} />
              )}
              {formatDate(book.publishedDate) && (
                <MetaRow
                  label="Published"
                  value={formatDate(book.publishedDate)!}
                />
              )}
              {book.isbn13 && <MetaRow label="ISBN-13" value={book.isbn13} />}
              {book.isbn10 && <MetaRow label="ISBN-10" value={book.isbn10} />}
              {book.goodreadsRating != null && (
                <MetaRow
                  label="Goodreads"
                  value={`${book.goodreadsRating.toFixed(2)} ★`}
                />
              )}
            </View>
          </View>

          {/* Genres & Tags */}
          {(book.genres.length > 0 || book.tags.length > 0) && (
            <View style={styles.section}>
              {book.genres.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Genres</Text>
                  <View style={styles.chips}>
                    {book.genres.map((g) => (
                      <View key={g} style={styles.chip}>
                        <Text style={styles.chipText}>{g}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
              {book.tags.length > 0 && (
                <>
                  <Text
                    style={[
                      styles.sectionTitle,
                      book.genres.length > 0 && { marginTop: 16 },
                    ]}
                  >
                    Tags
                  </Text>
                  <View style={styles.chips}>
                    {book.tags.map((t) => (
                      <View key={t} style={[styles.chip, styles.chipAlt]}>
                        <Text style={styles.chipText}>{t}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {/* Files / Downloads */}
          {book.files.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Files</Text>
              {book.files.map((file) => (
                <View key={file.id} style={styles.fileRow}>
                  <View style={styles.fileInfo}>
                    <View style={styles.formatBadge}>
                      <Text style={styles.formatText}>{file.format}</Text>
                    </View>
                    <Text style={styles.fileSize}>
                      {formatBytes(file.sizeBytes)}
                    </Text>
                    {file.missingAt && (
                      <Text style={styles.missingText}>Missing</Text>
                    )}
                  </View>
                  <View style={styles.fileActions}>
                    <Pressable
                      style={[
                        styles.sendBtn,
                        (!!file.missingAt ||
                          (sending && pendingSendFileId === file.id)) &&
                          styles.actionBtnDisabled,
                      ]}
                      onPress={() => handleSendPress(file.id)}
                      disabled={!!file.missingAt || sending}
                    >
                      {sending && pendingSendFileId === file.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="mail-outline" size={18} color="#fff" />
                      )}
                    </Pressable>
                    <Pressable
                      style={[
                        styles.downloadBtn,
                        (!!file.missingAt || downloadingId === file.id) &&
                          styles.actionBtnDisabled,
                      ]}
                      onPress={() => handleDownload(file.id, file.format)}
                      disabled={!!file.missingAt || downloadingId !== null}
                    >
                      {downloadingId === file.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons
                          name="download-outline"
                          size={18}
                          color="#fff"
                        />
                      )}
                      <Text style={styles.downloadText}>
                        {downloadingId === file.id
                          ? 'Downloading…'
                          : 'Download'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <EmailPickerModal
        visible={showEmailPicker}
        emails={recipientEmails}
        sending={sending}
        onSelect={(emailId) => {
          if (pendingSendFileId) doSend(pendingSendFileId, emailId);
        }}
        onClose={() => {
          setShowEmailPicker(false);
          setPendingSendFileId(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  backBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: { color: '#ff6b6b', fontSize: 15, textAlign: 'center' },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
  },
  retryText: { color: '#4a9eff', fontSize: 14, fontWeight: '600' },
  scroll: { paddingBottom: 40 },

  // Hero
  heroSection: {
    flexDirection: 'row',
    gap: 16,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  cover: { width: 110, height: 165, borderRadius: 6 },
  heroInfo: { flex: 1, justifyContent: 'center', gap: 6 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', lineHeight: 22 },
  subtitle: { color: '#aaa', fontSize: 14, lineHeight: 18 },
  authors: { color: '#4a9eff', fontSize: 13 },
  series: { color: '#777', fontSize: 12, fontStyle: 'italic' },

  // Reading progress
  progressSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#222',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#4a9eff',
    borderRadius: 2,
  },
  progressLabel: {
    color: '#666',
    fontSize: 12,
    marginTop: 6,
  },
  resetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ff6b6b44',
    minWidth: 52,
    alignItems: 'center',
  },
  resetBtnPressed: { opacity: 0.6 },
  resetBtnText: { color: '#ff6b6b', fontSize: 13, fontWeight: '600' },

  // Sections
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  description: { color: '#ccc', fontSize: 14, lineHeight: 21 },

  // Meta
  metaContainer: { gap: 0 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  metaLabel: { color: '#666', fontSize: 14 },
  metaValue: { color: '#ccc', fontSize: 14, flex: 1, textAlign: 'right' },

  // Chips
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#1c1c2e',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  chipAlt: { backgroundColor: '#1e1e1e' },
  chipText: { color: '#aaa', fontSize: 12 },

  // Files
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  fileInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  formatBadge: {
    backgroundColor: '#1c1c2e',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  formatText: {
    color: '#4a9eff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  fileSize: { color: '#666', fontSize: 13 },
  missingText: { color: '#ff6b6b', fontSize: 12 },
  fileActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sendBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c3a2e',
    padding: 10,
    borderRadius: 8,
    width: 40,
    height: 40,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1c3a5e',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 110,
    justifyContent: 'center',
  },
  actionBtnDisabled: { opacity: 0.4 },
  downloadText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Email picker modal
  pickerBackdrop: {
    flex: 1,
    backgroundColor: '#00000088',
  },
  pickerSheet: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  pickerHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  pickerTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  pickerDivider: {
    height: 1,
    backgroundColor: '#2c2c2e',
    marginBottom: 8,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  emailRowPressed: { opacity: 0.6 },
  emailRowContent: { flex: 1, gap: 2 },
  emailAddress: { color: '#fff', fontSize: 15 },
  emailLabel: { color: '#888', fontSize: 12 },
  defaultBadge: {
    color: '#4a9eff',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
