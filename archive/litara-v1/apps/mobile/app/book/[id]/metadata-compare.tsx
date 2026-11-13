import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { getBookDetail, applyBookMetadata } from '@/src/api/books';
import { metadataSearchStore } from '@/src/store/metadataSearchStore';
import type { BookDetail, MetadataResult } from '@/src/api/books';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

function isValidIsbn13(isbn: string | null | undefined): isbn is string {
  if (!isbn) return false;
  return /^\d{13}$/.test(isbn.replace(/-/g, ''));
}

function isValidIsbn10(isbn: string | null | undefined): isbn is string {
  if (!isbn) return false;
  return /^[\dX]{10}$/i.test(isbn.replace(/-/g, ''));
}

function toYear(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    const y = new Date(dateStr).getFullYear();
    return isNaN(y) ? null : String(y);
  } catch {
    return null;
  }
}

interface ComparisonRow {
  field: string;
  label: string;
  current: string | null;
  proposed: string | null | undefined;
  isImage?: boolean;
}

function buildRows(
  detail: BookDetail,
  result: MetadataResult,
  serverUrl: string,
  bookId: string,
): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  if (result.coverUrl) {
    rows.push({
      field: 'coverUrl',
      label: 'Cover',
      isImage: true,
      current: detail.hasCover
        ? `${serverUrl}/api/v1/books/${bookId}/cover`
        : null,
      proposed: result.coverUrl,
    });
  }

  rows.push(
    {
      field: 'title',
      label: 'Title',
      current: detail.title,
      proposed: result.title,
    },
    {
      field: 'subtitle',
      label: 'Subtitle',
      current: detail.subtitle,
      proposed: result.subtitle,
    },
    {
      field: 'authors',
      label: 'Authors',
      current: detail.authors.join(', ') || null,
      proposed: result.authors?.join(', '),
    },
    {
      field: 'description',
      label: 'Description',
      current: detail.description,
      proposed: result.description,
    },
    {
      field: 'publisher',
      label: 'Publisher',
      current: detail.publisher,
      proposed: result.publisher,
    },
    {
      field: 'publishedDate',
      label: 'Published',
      current: toYear(detail.publishedDate),
      proposed: toYear(result.publishedDate),
    },
    {
      field: 'language',
      label: 'Language',
      current: detail.language,
      proposed: result.language,
    },
    {
      field: 'pageCount',
      label: 'Pages',
      current: detail.pageCount != null ? String(detail.pageCount) : null,
      proposed: result.pageCount != null ? String(result.pageCount) : undefined,
    },
    {
      field: 'isbn13',
      label: 'ISBN-13',
      current: detail.isbn13,
      proposed: isValidIsbn13(result.isbn13) ? result.isbn13 : undefined,
    },
    {
      field: 'isbn10',
      label: 'ISBN-10',
      current: detail.isbn10,
      proposed: isValidIsbn10(result.isbn10) ? result.isbn10 : undefined,
    },
    {
      field: 'tags',
      label: 'Tags',
      current: detail.tags.join(', ') || null,
      proposed: result.categories?.join(', '),
    },
    {
      field: 'genres',
      label: 'Genres',
      current: detail.genres.join(', ') || null,
      proposed: result.genres?.join(', '),
    },
    {
      field: 'moods',
      label: 'Moods',
      current: detail.moods.join(', ') || null,
      proposed: result.moods?.join(', '),
    },
    {
      field: 'goodreadsRating',
      label: 'Goodreads Rating',
      current:
        detail.goodreadsRating != null ? String(detail.goodreadsRating) : null,
      proposed:
        result.goodreadsRating != null
          ? String(result.goodreadsRating)
          : undefined,
    },
    {
      field: 'seriesName',
      label: 'Series Name',
      current: detail.series?.name ?? null,
      proposed: result.seriesName,
    },
    {
      field: 'seriesPosition',
      label: 'Series #',
      current:
        detail.series?.sequence != null ? String(detail.series.sequence) : null,
      proposed:
        result.seriesPosition != null
          ? String(result.seriesPosition)
          : undefined,
    },
    {
      field: 'seriesTotalBooks',
      label: 'Total Books',
      current:
        detail.series?.totalBooks != null
          ? String(detail.series.totalBooks)
          : null,
      proposed:
        result.seriesTotalBooks != null
          ? String(result.seriesTotalBooks)
          : undefined,
    },
  );

  return rows.filter((r) => r.proposed != null && r.proposed !== '');
}

function buildPayload(
  result: MetadataResult,
  detail: BookDetail,
  selected: Set<string>,
): Record<string, unknown> {
  const should = (field: string) => selected.has(field);
  const p: Record<string, unknown> = {};

  if (should('coverUrl') && result.coverUrl) p.coverUrl = result.coverUrl;
  if (should('title') && result.title) p.title = result.title;
  if (should('subtitle') && result.subtitle) p.subtitle = result.subtitle;
  if (should('authors') && result.authors?.length) p.authors = result.authors;
  if (should('description') && result.description)
    p.description = result.description;
  if (should('publisher') && result.publisher) p.publisher = result.publisher;
  if (should('publishedDate') && result.publishedDate) {
    const d = new Date(result.publishedDate);
    if (!isNaN(d.getTime())) p.publishedDate = d.toISOString().slice(0, 10);
  }
  if (should('language') && result.language) p.language = result.language;
  if (should('pageCount') && result.pageCount) p.pageCount = result.pageCount;
  if (should('isbn13') && isValidIsbn13(result.isbn13))
    p.isbn13 = result.isbn13;
  if (should('isbn10') && isValidIsbn10(result.isbn10))
    p.isbn10 = result.isbn10;
  if (should('tags') && result.categories?.length) p.tags = result.categories;
  if (should('genres') && result.genres?.length) p.genres = result.genres;
  if (should('moods') && result.moods?.length) p.moods = result.moods;
  if (should('goodreadsRating') && result.goodreadsRating != null)
    p.goodreadsRating = result.goodreadsRating;

  // Series — use current name as anchor when only position/total is selected
  const shouldName = should('seriesName');
  const shouldSeq = should('seriesPosition');
  const shouldTotal = should('seriesTotalBooks');
  if (shouldName || shouldSeq || shouldTotal) {
    const name = shouldName
      ? (result.seriesName ?? null)
      : (detail.series?.name ?? null);
    p.seriesName = name;
    if (name) {
      if (shouldSeq) p.seriesPosition = result.seriesPosition ?? null;
      if (shouldTotal) p.seriesTotalBooks = result.seriesTotalBooks ?? null;
    }
  }

  return p;
}

interface CheckboxProps {
  checked: boolean;
}

function Checkbox({ checked }: CheckboxProps) {
  return (
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
      {checked ? <Ionicons name="checkmark" size={14} color="#000" /> : null}
    </View>
  );
}

interface FieldRowProps {
  row: ComparisonRow;
  selected: boolean;
  token: string;
  onToggle: () => void;
}

function FieldRow({ row, selected, token, onToggle }: FieldRowProps) {
  const isMatch =
    row.current != null && row.proposed != null && row.current === row.proposed;

  if (row.isImage) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.fieldRow,
          pressed && styles.fieldRowPressed,
        ]}
        onPress={onToggle}
      >
        <Checkbox checked={selected} />
        <View style={styles.fieldContent}>
          <Text style={styles.fieldName}>{row.label}</Text>
          <View style={styles.imageRow}>
            <View style={styles.imageCell}>
              <Text style={styles.imageLabel}>Current</Text>
              {row.current ? (
                <Image
                  source={{
                    uri: row.current,
                    headers: token
                      ? { Authorization: `Bearer ${token}` }
                      : undefined,
                  }}
                  style={styles.coverThumb}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.coverThumb, styles.coverThumbPlaceholder]}>
                  <Ionicons name="book-outline" size={20} color="#444" />
                </View>
              )}
            </View>
            <Ionicons name="arrow-forward" size={16} color="#444" />
            <View style={styles.imageCell}>
              <Text style={styles.imageLabel}>New</Text>
              <Image
                source={{ uri: row.proposed! }}
                style={styles.coverThumb}
                contentFit="cover"
              />
            </View>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.fieldRow,
        pressed && styles.fieldRowPressed,
      ]}
      onPress={onToggle}
    >
      <Checkbox checked={selected} />
      <View style={styles.fieldContent}>
        <Text style={styles.fieldName}>{row.label}</Text>
        {isMatch ? (
          <Text style={styles.alreadyMatches}>Already matches</Text>
        ) : (
          <>
            {row.current ? (
              <Text style={styles.currentValue} numberOfLines={3}>
                Current: {row.current}
              </Text>
            ) : (
              <Text style={styles.noCurrentValue}>Current: (none)</Text>
            )}
            <Text style={styles.proposedValue} numberOfLines={3}>
              New: {row.proposed}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export default function MetadataCompareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const serverUrl = serverUrlStore.get() ?? '';
  const token = tokenStore.get() ?? '';

  const selectedResult = metadataSearchStore.getSelected();

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', id],
    queryFn: () => getBookDetail(id),
    enabled: !!id,
  });

  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const didInit = useRef(false);

  useEffect(() => {
    if (book && selectedResult && !didInit.current) {
      didInit.current = true;
      const rows = buildRows(book, selectedResult.result, serverUrl, id);
      setSelectedFields(
        new Set(
          rows.filter((r) => r.current !== r.proposed).map((r) => r.field),
        ),
      );
    }
  }, [book, selectedResult, id, serverUrl]);

  const rows =
    book && selectedResult
      ? buildRows(book, selectedResult.result, serverUrl, id)
      : [];

  const toggleField = (field: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const handleApply = async () => {
    if (!book || !selectedResult) return;
    if (selectedFields.size === 0) {
      Alert.alert('No fields selected', 'Select at least one field to apply.');
      return;
    }

    const payload = buildPayload(selectedResult.result, book, selectedFields);
    if (Object.keys(payload).length === 0) {
      Alert.alert(
        'Nothing to apply',
        'No changes to apply for the selected fields.',
      );
      return;
    }

    setApplying(true);
    try {
      await applyBookMetadata(id, payload);
      await queryClient.invalidateQueries({ queryKey: ['book', id] });
      metadataSearchStore.clear();
      Alert.alert('Applied', 'Metadata updated successfully.', [
        {
          text: 'OK',
          onPress: () => router.navigate(`/book/${id}` as never),
        },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to apply metadata. Please try again.');
    } finally {
      setApplying(false);
    }
  };

  if (!selectedResult) {
    return (
      <View
        style={[styles.container, styles.centered, { paddingTop: insets.top }]}
      >
        <Text style={styles.errorText}>No result selected.</Text>
        <Pressable style={styles.retryBtn} onPress={() => router.back()}>
          <Text style={styles.retryText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Apply Metadata</Text>
        <View style={styles.backBtn} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4a9eff" />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.providerInfo}>
              <View style={styles.providerBadge}>
                <Text style={styles.providerBadgeText}>
                  {selectedResult.providerLabel}
                </Text>
              </View>
              <Text style={styles.resultTitle} numberOfLines={2}>
                {selectedResult.result.title ?? '(No title)'}
              </Text>
              {selectedResult.result.authors ? (
                <Text style={styles.resultAuthors}>
                  {selectedResult.result.authors.join(', ')}
                </Text>
              ) : null}
            </View>

            {rows.length === 0 ? (
              <View style={styles.emptyRows}>
                <Text style={styles.emptyRowsText}>
                  No fields to apply from this result.
                </Text>
              </View>
            ) : (
              rows.map((row) => (
                <FieldRow
                  key={row.field}
                  row={row}
                  selected={selectedFields.has(row.field)}
                  token={token}
                  onToggle={() => toggleField(row.field)}
                />
              ))
            )}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              style={[
                styles.applyBtn,
                (applying || selectedFields.size === 0) &&
                  styles.applyBtnDisabled,
              ]}
              onPress={handleApply}
              disabled={applying || selectedFields.size === 0}
            >
              {applying ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.applyBtnText}>
                  Apply {selectedFields.size} Field
                  {selectedFields.size !== 1 ? 's' : ''}
                </Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
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
  scroll: { paddingBottom: 100 },
  providerInfo: {
    padding: 16,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  providerBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a2f4a',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  providerBadgeText: {
    color: '#4a9eff',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  resultTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  resultAuthors: { color: '#4a9eff', fontSize: 13 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  fieldRowPressed: { backgroundColor: '#111' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#4a9eff',
    borderColor: '#4a9eff',
  },
  fieldContent: { flex: 1, gap: 4 },
  fieldName: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  currentValue: { color: '#666', fontSize: 13, lineHeight: 18 },
  noCurrentValue: { color: '#444', fontSize: 13, fontStyle: 'italic' },
  proposedValue: { color: '#fff', fontSize: 13, lineHeight: 18 },
  alreadyMatches: { color: '#4ade80', fontSize: 12, fontStyle: 'italic' },
  imageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  imageCell: { alignItems: 'center', gap: 4 },
  imageLabel: { color: '#666', fontSize: 11 },
  coverThumb: { width: 60, height: 90, borderRadius: 4 },
  coverThumbPlaceholder: {
    backgroundColor: '#1c1c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRows: { padding: 32, alignItems: 'center' },
  emptyRowsText: { color: '#666', fontSize: 14, textAlign: 'center' },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1c1c1e',
    backgroundColor: '#0a0a0a',
  },
  applyBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyBtnDisabled: { opacity: 0.4 },
  applyBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#ff6b6b', fontSize: 15, textAlign: 'center' },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#1c1c2e',
    borderRadius: 8,
  },
  retryText: { color: '#4a9eff', fontSize: 14, fontWeight: '600' },
});
