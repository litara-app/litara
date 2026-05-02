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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import {
  getBookDetail,
  getReadingProgress,
  resetReadingProgress,
  updateBook,
} from '@/src/api/books';
import { getRecipientEmails, sendBook } from '@/src/api/mail';
import type { RecipientEmail } from '@/src/api/mail';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';
import { addToQueue, removeFromQueue } from '@/src/api/reading-queue';
import { LibraryShelfPickerContent } from '@/src/components/LibraryShelfPickerContent';
import { StarRating } from '@/src/components/StarRating';

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

function formatAudioDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatAudioMime(mimeType: string): string {
  if (
    mimeType.includes('mp4') ||
    mimeType.includes('m4b') ||
    mimeType.includes('m4a')
  )
    return 'M4B';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'MP3';
  if (mimeType.includes('ogg')) return 'OGG';
  if (mimeType.includes('opus')) return 'OPUS';
  return mimeType.split('/')[1]?.toUpperCase() ?? mimeType;
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
  const [resettingSource, setResettingSource] = useState<
    'LITARA' | 'KOREADER' | null
  >(null);
  const [togglingQueue, setTogglingQueue] = useState(false);
  const [showLibraryShelf, setShowLibraryShelf] = useState(false);
  const [localRating, setLocalRating] = useState<number | null | undefined>(
    undefined,
  );
  const [savingRating, setSavingRating] = useState(false);
  const [activeFilesTab, setActiveFilesTab] = useState<'ebooks' | 'audiobooks'>(
    'ebooks',
  );
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

  const displayRating =
    localRating === undefined ? (book?.userReview.rating ?? null) : localRating;
  const isInQueue = book?.inReadingQueue ?? false;
  const showFileTabs =
    book != null && book.hasAudiobook && book.audiobookFiles.length > 0;

  const handleDownload = async (fileId: string, format: string) => {
    setDownloadingId(fileId);
    try {
      const url = `${serverUrl}/api/v1/books/${id}/files/${fileId}/download`;
      const safeName = (book?.title ?? id)
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .trim();
      const filename = `${safeName}.${format.toLowerCase()}`;
      const destFile = new File(Paths.document, filename);
      await File.downloadFileAsync(url, destFile, {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
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

  const handleResetProgress = (source: 'LITARA' | 'KOREADER') => {
    const label = source === 'LITARA' ? 'Litara' : 'KOReader';
    Alert.alert(
      `Reset ${label} Progress`,
      `This will clear your ${label} reading progress for this book.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setResettingSource(source);
            try {
              await resetReadingProgress(id, source);
              await refetchProgress();
              await queryClient.invalidateQueries({ queryKey: ['books'] });
            } catch {
              Alert.alert('Error', 'Failed to reset reading progress.');
            } finally {
              setResettingSource(null);
            }
          },
        },
      ],
    );
  };

  const handleToggleQueue = async () => {
    setTogglingQueue(true);
    try {
      if (isInQueue) {
        await removeFromQueue(id);
      } else {
        await addToQueue(id);
      }
      await queryClient.invalidateQueries({ queryKey: ['book', id] });
      await queryClient.invalidateQueries({ queryKey: ['reading-queue'] });
    } catch {
      Alert.alert('Error', 'Failed to update reading queue.');
    } finally {
      setTogglingQueue(false);
    }
  };

  const handleRatingChange = async (newRating: number | null) => {
    setLocalRating(newRating);
    setSavingRating(true);
    try {
      await updateBook(id, { rating: newRating });
      await queryClient.invalidateQueries({ queryKey: ['book', id] });
    } catch {
      setLocalRating(undefined);
      Alert.alert('Error', 'Failed to save rating.');
    } finally {
      setSavingRating(false);
    }
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

          {/* Action buttons */}
          <View style={styles.actionRow}>
            {book.hasAudiobook && (
              <Pressable
                style={styles.actionBtn}
                onPress={() => router.push(`/audiobook/${id}`)}
              >
                <Ionicons name="headset-outline" size={20} color="#000" />
                <Text style={styles.actionBtnText}>Listen</Text>
              </Pressable>
            )}
            <Pressable
              style={[
                styles.actionBtn,
                styles.actionBtnSecondary,
                isInQueue && styles.actionBtnActive,
              ]}
              onPress={handleToggleQueue}
              disabled={togglingQueue}
            >
              {togglingQueue ? (
                <ActivityIndicator size="small" color="#4a9eff" />
              ) : (
                <Ionicons
                  name={isInQueue ? 'checkmark-circle' : 'list-outline'}
                  size={20}
                  color={isInQueue ? '#4ade80' : '#ccc'}
                />
              )}
              <Text
                style={[styles.actionBtnText, styles.actionBtnTextSecondary]}
              >
                {isInQueue ? 'In Queue' : 'Add to Queue'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.actionBtnSecondary]}
              onPress={() => setShowLibraryShelf(true)}
            >
              <Ionicons name="library-outline" size={20} color="#ccc" />
              <Text
                style={[styles.actionBtnText, styles.actionBtnTextSecondary]}
              >
                Library
              </Text>
            </Pressable>
          </View>

          {/* Reading Progress */}
          {readingProgress != null &&
            readingProgress.filter((p) => (p.percentage ?? 0) > 0).length >
              0 && (
              <View style={styles.progressSection}>
                <Text style={styles.sectionTitle}>Reading Progress</Text>
                {readingProgress
                  .filter((p) => (p.percentage ?? 0) > 0)
                  .map((p) => {
                    const isLitara = p.source === 'LITARA';
                    const color = isLitara ? '#4ade80' : '#60a5fa';
                    const label = isLitara ? 'Litara' : 'KOReader';
                    const pct = Math.round((p.percentage ?? 0) * 100);
                    return (
                      <View key={p.source} style={styles.progressEntry}>
                        <View style={styles.progressHeader}>
                          <Text style={[styles.progressSourceLabel, { color }]}>
                            {label}
                          </Text>
                          <Pressable
                            style={({ pressed }) => [
                              styles.resetBtn,
                              pressed && styles.resetBtnPressed,
                            ]}
                            onPress={() => handleResetProgress(p.source)}
                            disabled={resettingSource !== null}
                          >
                            {resettingSource === p.source ? (
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
                                width: `${pct}%` as `${number}%`,
                                backgroundColor: color,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.progressLabel}>{pct}% read</Text>
                      </View>
                    );
                  })}
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
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>My Rating</Text>
                <View style={styles.ratingRow}>
                  {savingRating && (
                    <ActivityIndicator
                      size="small"
                      color="#4a9eff"
                      style={styles.ratingSpinner}
                    />
                  )}
                  <StarRating
                    rating={displayRating}
                    onChange={handleRatingChange}
                    size={24}
                  />
                </View>
              </View>
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

          {/* Files / Downloads — tabbed when audiobook exists */}
          {(book.files.length > 0 || showFileTabs) && (
            <View style={styles.section}>
              {showFileTabs ? (
                <>
                  <View style={styles.fileTabRow}>
                    <Pressable
                      style={[
                        styles.fileTab,
                        activeFilesTab === 'ebooks' && styles.fileTabActive,
                      ]}
                      onPress={() => setActiveFilesTab('ebooks')}
                    >
                      <Text
                        style={[
                          styles.fileTabText,
                          activeFilesTab === 'ebooks' &&
                            styles.fileTabTextActive,
                        ]}
                      >
                        Ebooks
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.fileTab,
                        activeFilesTab === 'audiobooks' && styles.fileTabActive,
                      ]}
                      onPress={() => setActiveFilesTab('audiobooks')}
                    >
                      <Text
                        style={[
                          styles.fileTabText,
                          activeFilesTab === 'audiobooks' &&
                            styles.fileTabTextActive,
                        ]}
                      >
                        Audiobooks
                      </Text>
                    </Pressable>
                  </View>

                  {activeFilesTab === 'ebooks' &&
                    (book.files.length === 0 ? (
                      <Text style={styles.emptyFilesText}>No ebook files.</Text>
                    ) : (
                      book.files.map((file) => (
                        <FileRow
                          key={file.id}
                          file={file}
                          sending={sending}
                          pendingSendFileId={pendingSendFileId}
                          downloadingId={downloadingId}
                          onSend={() => handleSendPress(file.id)}
                          onDownload={() =>
                            handleDownload(file.id, file.format)
                          }
                        />
                      ))
                    ))}

                  {activeFilesTab === 'audiobooks' &&
                    book.audiobookFiles.map((af) => (
                      <View key={af.id} style={styles.audioFileRow}>
                        <View style={styles.audioFileInfo}>
                          <View style={styles.formatBadge}>
                            <Text style={styles.formatText}>
                              {formatAudioMime(af.mimeType)}
                            </Text>
                          </View>
                          <View style={styles.audioFileMeta}>
                            <Text style={styles.audioFileTitle}>
                              Part {af.fileIndex + 1}
                            </Text>
                            <Text style={styles.audioFileDetail}>
                              {formatAudioDuration(af.duration)}
                              {af.narrator ? ` · ${af.narrator}` : ''}
                              {' · '}
                              {(af.fileSize / (1024 * 1024)).toFixed(1)} MB
                            </Text>
                          </View>
                        </View>
                        <Pressable
                          style={styles.playBtn}
                          onPress={() => router.push(`/audiobook/${id}`)}
                        >
                          <Ionicons name="play" size={16} color="#000" />
                        </Pressable>
                      </View>
                    ))}
                </>
              ) : (
                <>
                  <Text style={styles.sectionTitle}>Files</Text>
                  {book.files.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      sending={sending}
                      pendingSendFileId={pendingSendFileId}
                      downloadingId={downloadingId}
                      onSend={() => handleSendPress(file.id)}
                      onDownload={() => handleDownload(file.id, file.format)}
                    />
                  ))}
                </>
              )}
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

      {/* Library & Shelf picker modal */}
      <Modal
        visible={showLibraryShelf}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLibraryShelf(false)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setShowLibraryShelf(false)}
        />
        <View style={styles.libraryPickerSheet}>
          <View style={styles.pickerHandle} />
          <Text style={styles.libraryPickerTitle}>Library & Shelves</Text>
          <View style={styles.pickerDivider} />
          <LibraryShelfPickerContent
            bookId={id}
            onBack={() => setShowLibraryShelf(false)}
            onSaved={() =>
              queryClient.invalidateQueries({ queryKey: ['book', id] })
            }
          />
        </View>
      </Modal>
    </View>
  );
}

interface FileRowProps {
  file: {
    id: string;
    format: string;
    sizeBytes: string;
    missingAt: Date | null;
  };
  sending: boolean;
  pendingSendFileId: string | null;
  downloadingId: string | null;
  onSend: () => void;
  onDownload: () => void;
}

function FileRow({
  file,
  sending,
  pendingSendFileId,
  downloadingId,
  onSend,
  onDownload,
}: FileRowProps) {
  return (
    <View style={styles.fileRow}>
      <View style={styles.fileInfo}>
        <View style={styles.formatBadge}>
          <Text style={styles.formatText}>{file.format}</Text>
        </View>
        <Text style={styles.fileSize}>{formatBytes(file.sizeBytes)}</Text>
        {file.missingAt && <Text style={styles.missingText}>Missing</Text>}
      </View>
      <View style={styles.fileActions}>
        <Pressable
          style={[
            styles.sendBtn,
            (!!file.missingAt || (sending && pendingSendFileId === file.id)) &&
              styles.actionBtnDisabled,
          ]}
          onPress={onSend}
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
          onPress={onDownload}
          disabled={!!file.missingAt || downloadingId !== null}
        >
          {downloadingId === file.id ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="download-outline" size={18} color="#fff" />
          )}
          <Text style={styles.downloadText}>
            {downloadingId === file.id ? 'Downloading…' : 'Download'}
          </Text>
        </Pressable>
      </View>
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

  // Action buttons
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 11,
  },
  actionBtnSecondary: {
    backgroundColor: '#1c1c2e',
  },
  actionBtnActive: {
    backgroundColor: '#0f2a1e',
    borderWidth: 1,
    borderColor: '#4ade8040',
  },
  actionBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '600',
  },
  actionBtnTextSecondary: {
    color: '#ccc',
  },

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
  progressEntry: {
    marginBottom: 16,
  },
  progressSourceLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  progressFill: {
    height: 4,
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
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  metaLabel: { color: '#666', fontSize: 14 },
  metaValue: { color: '#ccc', fontSize: 14, flex: 1, textAlign: 'right' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingSpinner: { marginRight: 4 },

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

  // File tabs
  fileTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  fileTab: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#1c1c2e',
  },
  fileTabActive: { backgroundColor: '#4a9eff' },
  fileTabText: { color: '#888', fontSize: 13, fontWeight: '600' },
  fileTabTextActive: { color: '#000' },
  emptyFilesText: { color: '#666', fontSize: 14, paddingVertical: 12 },

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

  // Audiobook file rows
  audioFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  audioFileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  audioFileMeta: { flex: 1 },
  audioFileTitle: { color: '#ccc', fontSize: 14, fontWeight: '600' },
  audioFileDetail: { color: '#666', fontSize: 12, marginTop: 2 },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

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

  // Library picker sheet (taller than email picker)
  libraryPickerSheet: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 40,
    paddingHorizontal: 20,
    paddingTop: 0,
  },
  libraryPickerTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
});
