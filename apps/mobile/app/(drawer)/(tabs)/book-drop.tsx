import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';

const SUPPORTED_EXT = ['epub', 'mobi', 'azw', 'azw3', 'cbz', 'pdf'];

interface UploadResult {
  filename: string;
  status: 'success' | 'duplicate' | 'error';
  title?: string | null;
  authors?: string;
  message?: string;
}

function parseAuthors(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return (JSON.parse(raw) as string[]).join(', ');
  } catch {
    return raw;
  }
}

export default function BookDropScreen() {
  const [results, setResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    const newResults: UploadResult[] = [];

    for (const asset of result.assets) {
      const ext = asset.name.split('.').pop()?.toLowerCase() ?? '';
      if (!SUPPORTED_EXT.includes(ext)) {
        newResults.push({
          filename: asset.name,
          status: 'error',
          message: 'Unsupported file type',
        });
        continue;
      }

      const form = new FormData();
      form.append('files', {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
      } as unknown as Blob);

      try {
        const res = await api.post<
          { title?: string | null; authors?: string }[]
        >('/book-drop/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const book = res.data[0];
        newResults.push({
          filename: asset.name,
          status: 'success',
          title: book?.title,
          authors: parseAuthors(book?.authors),
        });
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } }).response
          ?.status;
        if (status === 409) {
          newResults.push({
            filename: asset.name,
            status: 'duplicate',
            message: 'Already in the pending queue',
          });
        } else {
          newResults.push({
            filename: asset.name,
            status: 'error',
            message: 'Upload failed. Please try again.',
          });
        }
      }
    }

    setResults((prev) => [...newResults, ...prev]);
    setUploading(false);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Book Drop</Text>
      <Text style={styles.subheading}>
        Select ebook files to add them to the admin review queue. Supported:
        EPUB, MOBI, AZW, AZW3, CBZ, PDF.
      </Text>

      <Pressable
        style={[styles.dropZone, uploading && styles.dropZoneDisabled]}
        onPress={() => !uploading && void handlePickFile()}
      >
        {uploading ? (
          <ActivityIndicator color="#4a9eff" />
        ) : (
          <>
            <Ionicons name="cloud-upload-outline" size={48} color="#4a9eff" />
            <Text style={styles.dropZoneText}>Tap to select files</Text>
          </>
        )}
      </Pressable>

      {results.length > 0 && (
        <View style={styles.resultsList}>
          <Text style={styles.resultsHeading}>Upload results</Text>
          {results.map((r, i) => (
            <View
              key={i}
              style={[
                styles.resultCard,
                r.status === 'error' && styles.resultCardError,
                r.status === 'duplicate' && styles.resultCardWarning,
              ]}
            >
              {r.status === 'success' ? (
                <>
                  <View style={styles.resultRow}>
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color="#2ecc71"
                    />
                    <Text style={styles.resultTitle} numberOfLines={1}>
                      {r.title ?? r.filename}
                    </Text>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Pending Review</Text>
                    </View>
                  </View>
                  {r.authors ? (
                    <Text style={styles.resultMeta}>{r.authors}</Text>
                  ) : null}
                  <Text style={styles.resultFilename}>{r.filename}</Text>
                </>
              ) : (
                <View style={styles.resultRow}>
                  <Ionicons
                    name={
                      r.status === 'duplicate'
                        ? 'warning-outline'
                        : 'close-circle'
                    }
                    size={18}
                    color={r.status === 'duplicate' ? '#f0a500' : '#e66465'}
                  />
                  <Text style={styles.resultErrorText} numberOfLines={2}>
                    {r.filename} — {r.message}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 16, gap: 16 },
  heading: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subheading: { color: '#888', fontSize: 14, lineHeight: 20 },
  dropZone: {
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111',
  },
  dropZoneDisabled: { opacity: 0.6 },
  dropZoneText: { color: '#4a9eff', fontSize: 16, fontWeight: '600' },
  resultsList: { gap: 8 },
  resultsHeading: { color: '#fff', fontWeight: '600', marginBottom: 4 },
  resultCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  resultCardError: { borderColor: '#7a2323' },
  resultCardWarning: { borderColor: '#7a5800' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { color: '#fff', flex: 1, fontWeight: '500' },
  resultMeta: { color: '#888', fontSize: 12 },
  resultFilename: { color: '#555', fontSize: 11 },
  resultErrorText: { color: '#aaa', flex: 1, fontSize: 13 },
  badge: {
    backgroundColor: '#1a4a2a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { color: '#2ecc71', fontSize: 11, fontWeight: '600' },
});
