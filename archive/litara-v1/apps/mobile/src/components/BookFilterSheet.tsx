import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  type BookFilterState,
  type ReadStatusValue,
  type FilterMode,
  type SeriesFilter,
  type MediaTypeFilter,
  type PageCountFilter,
  type AddedFilter,
  EMPTY_FILTER,
} from '@/src/types/bookFilter';
import type { AuthorOption } from '@/src/hooks/useBookFilter';

interface BookFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  filters: BookFilterState;
  setFilters: (f: BookFilterState) => void;
  activeCount: number;
  availableGenres: string[];
  availableTags: string[];
  availableFormats: string[];
  availableMoods: string[];
  availablePublishers: string[];
  availableAuthors: AuthorOption[];
}

// ─── Small primitives ────────────────────────────────────────────────────────

interface SegButtonProps {
  label: string;
  active: boolean;
  onPress: () => void;
  first?: boolean;
  last?: boolean;
}

function SegButton({ label, active, onPress, first, last }: SegButtonProps) {
  return (
    <Pressable
      style={[
        styles.segBtn,
        active && styles.segBtnActive,
        first && styles.segBtnFirst,
        last && styles.segBtnLast,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SegGroupProps<T extends string> {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}

function SegGroup<T extends string>({
  options,
  value,
  onChange,
}: SegGroupProps<T>) {
  return (
    <View style={styles.segGroup}>
      {options.map((opt, i) => (
        <SegButton
          key={opt.value}
          label={opt.label}
          active={value === opt.value}
          onPress={() => onChange(opt.value)}
          first={i === 0}
          last={i === options.length - 1}
        />
      ))}
    </View>
  );
}

interface ChipToggleProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function ChipToggle({ label, active, onPress }: ChipToggleProps) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface CheckRowProps {
  label: string;
  sublabel?: string;
  checked: boolean;
  onPress: () => void;
}

function CheckRow({ label, sublabel, checked, onPress }: CheckRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.checkRow, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.checkBox}>
        {checked && <Ionicons name="checkmark" size={14} color="#4a9eff" />}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
      {sublabel && <Text style={styles.checkSublabel}>{sublabel}</Text>}
    </Pressable>
  );
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.section}>
      <Pressable
        style={styles.sectionHeader}
        onPress={() => setOpen((v) => !v)}
      >
        <Text style={styles.sectionTitle}>{title}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color="#666"
        />
      </Pressable>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

// ─── Main sheet ───────────────────────────────────────────────────────────────

export function BookFilterSheet({
  visible,
  onClose,
  filters,
  setFilters,
  activeCount,
  availableGenres,
  availableTags,
  availableFormats,
  availableMoods,
  availablePublishers,
  availableAuthors,
}: BookFilterSheetProps) {
  const [authorSearch, setAuthorSearch] = useState('');

  function set<K extends keyof BookFilterState>(
    key: K,
    value: BookFilterState[K],
  ) {
    setFilters({ ...filters, [key]: value });
  }

  function toggleArray<T>(arr: T[], item: T): T[] {
    return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  }

  const filteredAuthors = authorSearch
    ? availableAuthors.filter((a) =>
        a.name.toLowerCase().includes(authorSearch.toLowerCase()),
      )
    : availableAuthors;

  const hasContent =
    availableGenres.length > 0 ||
    availableTags.length > 0 ||
    availableMoods.length > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        {/* Header */}
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </Text>
          <View style={styles.headerActions}>
            {activeCount > 0 && (
              <Pressable
                onPress={() =>
                  setFilters({
                    ...EMPTY_FILTER,
                    filterMode: filters.filterMode,
                  })
                }
                style={styles.clearBtn}
              >
                <Text style={styles.clearBtnText}>Clear all</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#888" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Filter mode */}
          <View style={styles.filterModeRow}>
            <Text style={styles.label}>Match</Text>
            <SegGroup<FilterMode>
              options={[
                { label: 'AND', value: 'and' },
                { label: 'OR', value: 'or' },
                { label: 'NOT', value: 'not' },
              ]}
              value={filters.filterMode}
              onChange={(v) => set('filterMode', v)}
            />
          </View>

          <View style={styles.divider} />

          {/* Status */}
          <Section title="Status" defaultOpen>
            <Text style={styles.label}>Read Status</Text>
            <View style={styles.chipRow}>
              {(
                [
                  { label: 'Unread', value: 'UNREAD' },
                  { label: 'Reading', value: 'READING' },
                  { label: 'Read', value: 'READ' },
                  { label: "Won't Read", value: 'WONT_READ' },
                ] as { label: string; value: ReadStatusValue }[]
              ).map((s) => (
                <ChipToggle
                  key={s.value}
                  label={s.label}
                  active={filters.readStatuses.includes(s.value)}
                  onPress={() =>
                    set(
                      'readStatuses',
                      toggleArray(filters.readStatuses, s.value),
                    )
                  }
                />
              ))}
            </View>
          </Section>

          <View style={styles.divider} />

          {/* Rating */}
          <Section title="Rating">
            <Text style={styles.label}>My Rating (min)</Text>
            <SegGroup<string>
              options={[
                { label: 'Any', value: 'any' },
                { label: '★1+', value: '1' },
                { label: '★2+', value: '2' },
                { label: '★3+', value: '3' },
                { label: '★4+', value: '4' },
                { label: '★5', value: '5' },
              ]}
              value={
                filters.minRating === null ? 'any' : String(filters.minRating)
              }
              onChange={(v) => set('minRating', v === 'any' ? null : Number(v))}
            />
            <Text style={[styles.label, styles.labelSpaced]}>
              Goodreads Rating (min)
            </Text>
            <SegGroup<string>
              options={[
                { label: 'Any', value: 'any' },
                { label: '3+', value: '3' },
                { label: '3.5+', value: '3.5' },
                { label: '4+', value: '4' },
                { label: '4.5+', value: '4.5' },
              ]}
              value={
                filters.minGoodreadsRating === null
                  ? 'any'
                  : String(filters.minGoodreadsRating)
              }
              onChange={(v) =>
                set('minGoodreadsRating', v === 'any' ? null : Number(v))
              }
            />
          </Section>

          {/* Content */}
          {hasContent && (
            <>
              <View style={styles.divider} />
              <Section title="Content">
                {availableGenres.length > 0 && (
                  <>
                    <Text style={styles.label}>Genres</Text>
                    <View style={styles.checkList}>
                      {availableGenres.map((g) => (
                        <CheckRow
                          key={g}
                          label={g}
                          checked={filters.genres.includes(g)}
                          onPress={() =>
                            set('genres', toggleArray(filters.genres, g))
                          }
                        />
                      ))}
                    </View>
                  </>
                )}
                {availableTags.length > 0 && (
                  <>
                    <Text style={[styles.label, styles.labelSpaced]}>Tags</Text>
                    <View style={styles.checkList}>
                      {availableTags.map((t) => (
                        <CheckRow
                          key={t}
                          label={t}
                          checked={filters.tags.includes(t)}
                          onPress={() =>
                            set('tags', toggleArray(filters.tags, t))
                          }
                        />
                      ))}
                    </View>
                  </>
                )}
                {availableMoods.length > 0 && (
                  <>
                    <Text style={[styles.label, styles.labelSpaced]}>
                      Moods
                    </Text>
                    <View style={styles.checkList}>
                      {availableMoods.map((m) => (
                        <CheckRow
                          key={m}
                          label={m}
                          checked={filters.moods.includes(m)}
                          onPress={() =>
                            set('moods', toggleArray(filters.moods, m))
                          }
                        />
                      ))}
                    </View>
                  </>
                )}
              </Section>
            </>
          )}

          {/* Authors */}
          {availableAuthors.length > 0 && (
            <>
              <View style={styles.divider} />
              <Section title="Authors">
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search authors…"
                  placeholderTextColor="#555"
                  value={authorSearch}
                  onChangeText={setAuthorSearch}
                  autoCorrect={false}
                />
                <View style={styles.checkList}>
                  {filteredAuthors.map(({ name, count }) => (
                    <CheckRow
                      key={name}
                      label={name}
                      sublabel={`(${count})`}
                      checked={filters.authors.includes(name)}
                      onPress={() =>
                        set('authors', toggleArray(filters.authors, name))
                      }
                    />
                  ))}
                </View>
              </Section>
            </>
          )}

          <View style={styles.divider} />

          {/* Book Details */}
          <Section title="Book Details">
            {availableFormats.length > 0 && (
              <>
                <Text style={styles.label}>Format</Text>
                <View style={styles.chipRow}>
                  {availableFormats.map((fmt) => (
                    <ChipToggle
                      key={fmt}
                      label={fmt}
                      active={filters.formats.includes(fmt)}
                      onPress={() =>
                        set('formats', toggleArray(filters.formats, fmt))
                      }
                    />
                  ))}
                </View>
              </>
            )}
            {availablePublishers.length > 0 && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>
                  Publisher
                </Text>
                <View style={styles.checkList}>
                  {availablePublishers.map((p) => (
                    <CheckRow
                      key={p}
                      label={p}
                      checked={filters.publishers.includes(p)}
                      onPress={() =>
                        set('publishers', toggleArray(filters.publishers, p))
                      }
                    />
                  ))}
                </View>
              </>
            )}
            <Text style={[styles.label, styles.labelSpaced]}>Page Count</Text>
            <SegGroup<PageCountFilter>
              options={[
                { label: 'Any', value: 'any' },
                { label: '<150', value: 'short' },
                { label: '150–400', value: 'medium' },
                { label: '400+', value: 'long' },
              ]}
              value={filters.pageCountFilter}
              onChange={(v) => set('pageCountFilter', v)}
            />
            <Text style={[styles.label, styles.labelSpaced]}>
              Published Year
            </Text>
            <View style={styles.yearRow}>
              <TextInput
                style={styles.yearInput}
                placeholder="From"
                placeholderTextColor="#555"
                keyboardType="number-pad"
                maxLength={4}
                value={filters.publishedYearFrom?.toString() ?? ''}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  set('publishedYearFrom', v === '' || isNaN(n) ? null : n);
                }}
              />
              <Text style={styles.yearDash}>–</Text>
              <TextInput
                style={styles.yearInput}
                placeholder="To"
                placeholderTextColor="#555"
                keyboardType="number-pad"
                maxLength={4}
                value={filters.publishedYearTo?.toString() ?? ''}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  set('publishedYearTo', v === '' || isNaN(n) ? null : n);
                }}
              />
            </View>
          </Section>

          <View style={styles.divider} />

          {/* Library */}
          <Section title="Library">
            <Text style={styles.label}>Media Type</Text>
            <SegGroup<MediaTypeFilter>
              options={[
                { label: 'Any', value: 'any' },
                { label: 'Ebook', value: 'ebook-only' },
                { label: 'Audio', value: 'audiobook-only' },
                { label: 'Both', value: 'both' },
              ]}
              value={filters.mediaTypeFilter}
              onChange={(v) => set('mediaTypeFilter', v)}
            />
            <Text style={[styles.label, styles.labelSpaced]}>Series</Text>
            <SegGroup<SeriesFilter>
              options={[
                { label: 'Any', value: 'any' },
                { label: 'In Series', value: 'has-series' },
                { label: 'Standalone', value: 'no-series' },
              ]}
              value={filters.seriesFilter}
              onChange={(v) => set('seriesFilter', v)}
            />
            <Text style={[styles.label, styles.labelSpaced]}>
              Added to Library
            </Text>
            <SegGroup<AddedFilter>
              options={[
                { label: 'Any', value: 'any' },
                { label: '7d', value: 'last-7' },
                { label: '30d', value: 'last-30' },
                { label: '6mo', value: 'last-180' },
              ]}
              value={filters.addedFilter}
              onChange={(v) => set('addedFilter', v)}
            />
          </Section>

          <View style={styles.bottomPad} />
        </ScrollView>
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
    maxHeight: '90%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#2c2c2e',
  },
  clearBtnText: {
    color: '#4a9eff',
    fontSize: 13,
    fontWeight: '600',
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 20 },
  bottomPad: { height: 40 },

  filterModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },

  divider: {
    height: 1,
    backgroundColor: '#2c2c2e',
  },

  // Section accordion
  section: {
    paddingVertical: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionBody: {
    paddingBottom: 12,
  },

  label: {
    color: '#666',
    fontSize: 12,
    marginBottom: 8,
  },
  labelSpaced: {
    marginTop: 14,
  },

  // Segmented control
  segGroup: {
    flexDirection: 'row',
  },
  segBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: '#2c2c2e',
    borderWidth: 1,
    borderColor: '#3a3a3c',
    marginLeft: -1,
  },
  segBtnFirst: {
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    marginLeft: 0,
  },
  segBtnLast: {
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  segBtnActive: {
    backgroundColor: '#4a9eff',
    borderColor: '#4a9eff',
    zIndex: 1,
  },
  segBtnText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  segBtnTextActive: {
    color: '#000',
  },

  // Chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#2c2c2e',
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  chipActive: {
    backgroundColor: '#1a3a5e',
    borderColor: '#4a9eff',
  },
  chipText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#4a9eff',
  },

  // Check rows
  checkList: {
    gap: 0,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2c2c2e',
  },
  rowPressed: { opacity: 0.6 },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    backgroundColor: '#2c2c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: {
    color: '#ccc',
    fontSize: 14,
    flex: 1,
  },
  checkSublabel: {
    color: '#555',
    fontSize: 12,
  },

  // Author search
  searchInput: {
    backgroundColor: '#2c2c2e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },

  // Year inputs
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  yearInput: {
    flex: 1,
    backgroundColor: '#2c2c2e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    textAlign: 'center',
  },
  yearDash: {
    color: '#555',
    fontSize: 16,
  },
});
