import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMetadataProviders } from '@/src/api/settings';
import { searchBookMetadata } from '@/src/api/books';
import { metadataSearchStore } from '@/src/store/metadataSearchStore';

export default function SearchMetadataScreen() {
  const { id, title: initialTitle } = useLocalSearchParams<{
    id: string;
    title: string;
  }>();
  const insets = useSafeAreaInsets();

  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(
    new Set(),
  );
  const [titleInput, setTitleInput] = useState(
    typeof initialTitle === 'string' ? initialTitle : '',
  );
  const [authorInput, setAuthorInput] = useState('');
  const [isbnInput, setIsbnInput] = useState('');
  const [searching, setSearching] = useState(false);
  const didInit = useRef(false);

  const { data: providers = [], isLoading: loadingProviders } = useQuery({
    queryKey: ['metadata-providers'],
    queryFn: getMetadataProviders,
  });

  useEffect(() => {
    if (providers.length > 0 && !didInit.current) {
      didInit.current = true;
      setSelectedProviders(new Set(providers.map((p) => p.id)));
    }
  }, [providers]);

  const toggleProvider = (providerId: string) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  const handleSearch = async () => {
    if (selectedProviders.size === 0) {
      Alert.alert('No providers', 'Select at least one provider to search.');
      return;
    }
    if (!titleInput.trim() && !isbnInput.trim()) {
      Alert.alert('No search terms', 'Enter a title or ISBN to search.');
      return;
    }

    setSearching(true);
    try {
      const params: { title?: string; author?: string; isbn?: string } = {};
      if (titleInput.trim()) params.title = titleInput.trim();
      if (authorInput.trim()) params.author = authorInput.trim();
      if (isbnInput.trim()) params.isbn = isbnInput.trim();

      const labelMap = new Map(providers.map((p) => [p.id, p.label]));
      const calls = Array.from(selectedProviders).map(async (provider) => {
        const flat = await searchBookMetadata(id, provider, params).catch(
          () => [],
        );
        return flat.map((result) => ({
          provider,
          providerLabel: labelMap.get(provider) ?? provider,
          result,
        }));
      });
      const results = (await Promise.all(calls)).flat();

      metadataSearchStore.setResults(results);
      router.push(`/book/${id}/metadata-results` as never);
    } catch {
      Alert.alert(
        'Search failed',
        'Could not fetch metadata. Please try again.',
      );
    } finally {
      setSearching(false);
    }
  };

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
        <Text style={styles.headerTitle}>Search Metadata</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>Providers</Text>
        {loadingProviders ? (
          <ActivityIndicator color="#4a9eff" style={styles.providerLoader} />
        ) : (
          <View style={styles.providerChips}>
            {providers.map((p) => {
              const active = selectedProviders.has(p.id);
              return (
                <Pressable
                  key={p.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleProvider(p.id)}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={[styles.sectionLabel, styles.sectionLabelMt]}>
          Search Terms
        </Text>
        <View style={styles.inputGroup}>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Title</Text>
            <TextInput
              style={styles.input}
              value={titleInput}
              onChangeText={setTitleInput}
              placeholder="Book title"
              placeholderTextColor="#555"
              returnKeyType="next"
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Author</Text>
            <TextInput
              style={styles.input}
              value={authorInput}
              onChangeText={setAuthorInput}
              placeholder="Author name"
              placeholderTextColor="#555"
              returnKeyType="next"
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>ISBN</Text>
            <TextInput
              style={styles.input}
              value={isbnInput}
              onChangeText={setIsbnInput}
              placeholder="ISBN-10 or ISBN-13"
              placeholderTextColor="#555"
              keyboardType="number-pad"
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
          </View>
        </View>

        <Pressable
          style={[
            styles.searchBtn,
            (searching || selectedProviders.size === 0) &&
              styles.searchBtnDisabled,
          ]}
          onPress={handleSearch}
          disabled={searching || selectedProviders.size === 0}
        >
          {searching ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Ionicons name="search-outline" size={18} color="#000" />
              <Text style={styles.searchBtnText}>Search</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
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
  scroll: { padding: 20, paddingBottom: 48 },
  sectionLabel: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  sectionLabelMt: { marginTop: 28 },
  providerLoader: { marginVertical: 12 },
  providerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1c1c2e',
    borderWidth: 1,
    borderColor: '#2c2c3e',
  },
  chipActive: {
    backgroundColor: '#1a2f4a',
    borderColor: '#4a9eff',
  },
  chipText: { color: '#888', fontSize: 14, fontWeight: '500' },
  chipTextActive: { color: '#4a9eff' },
  inputGroup: {
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    overflow: 'hidden',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputLabel: {
    color: '#666',
    fontSize: 14,
    width: 56,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 0,
  },
  separator: { height: 1, backgroundColor: '#2c2c2e', marginLeft: 16 },
  searchBtn: {
    marginTop: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
  },
  searchBtnDisabled: { opacity: 0.4 },
  searchBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
