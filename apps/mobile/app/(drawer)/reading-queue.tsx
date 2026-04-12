import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getReadingQueue,
  removeFromQueue,
  reorderQueue,
} from '@/src/api/reading-queue';
import type { ReadingQueueItem } from '@/src/api/reading-queue';
import { serverUrlStore } from '@/src/auth/serverUrlStore';
import { tokenStore } from '@/src/auth/tokenStore';

export default function ReadingQueueScreen() {
  const queryClient = useQueryClient();

  const {
    data: queue = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['reading-queue'],
    queryFn: getReadingQueue,
  });

  async function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= queue.length) return;

    const reordered = [...queue];
    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ];

    // Optimistic update
    queryClient.setQueryData<ReadingQueueItem[]>(['reading-queue'], reordered);

    try {
      await reorderQueue(reordered.map((item) => item.bookId));
    } catch {
      await refetch();
    }
  }

  async function handleRemove(item: ReadingQueueItem) {
    Alert.alert(
      'Remove from Queue',
      `Remove "${item.title}" from your reading queue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            queryClient.setQueryData<ReadingQueueItem[]>(
              ['reading-queue'],
              (prev) => prev?.filter((i) => i.bookId !== item.bookId) ?? [],
            );
            try {
              await removeFromQueue(item.bookId);
            } catch {
              await refetch();
            }
          },
        },
      ],
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4a9eff" />
      </View>
    );
  }

  if (queue.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="list-outline" size={48} color="#333" />
        <Text style={styles.emptyTitle}>Queue is empty</Text>
        <Text style={styles.emptySubtitle}>
          Long-press any book and choose &ldquo;Add to Queue&rdquo; to get
          started.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={queue}
      keyExtractor={(item) => item.bookId}
      refreshing={isRefetching}
      onRefresh={refetch}
      renderItem={({ item, index }) => (
        <QueueRow
          item={item}
          index={index}
          isFirst={index === 0}
          isLast={index === queue.length - 1}
          onMoveUp={() => handleMove(index, -1)}
          onMoveDown={() => handleMove(index, 1)}
          onRemove={() => handleRemove(item)}
        />
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

interface QueueRowProps {
  item: ReadingQueueItem;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

function QueueRow({
  item,
  index,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QueueRowProps) {
  const baseUrl = serverUrlStore.get();
  const token = tokenStore.get();

  const coverSource =
    item.hasCover && baseUrl
      ? {
          uri: `${baseUrl}/api/v1/books/${item.bookId}/cover`,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      : require('@/assets/images/icon.png');

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        router.push({ pathname: '/book/[id]', params: { id: item.bookId } })
      }
    >
      <Text style={styles.position}>{index + 1}</Text>

      <Image source={coverSource} style={styles.cover} contentFit="cover" />

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        {item.authors.length > 0 && (
          <Text style={styles.authors} numberOfLines={1}>
            {item.authors.join(', ')}
          </Text>
        )}
        {item.formats.length > 0 && (
          <Text style={styles.format}>{item.formats[0]}</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.arrowBtn, isFirst && styles.arrowBtnDisabled]}
          onPress={onMoveUp}
          disabled={isFirst}
          hitSlop={6}
        >
          <Ionicons
            name="chevron-up"
            size={20}
            color={isFirst ? '#333' : '#888'}
          />
        </Pressable>
        <Pressable
          style={[styles.arrowBtn, isLast && styles.arrowBtnDisabled]}
          onPress={onMoveDown}
          disabled={isLast}
          hitSlop={6}
        >
          <Ionicons
            name="chevron-down"
            size={20}
            color={isLast ? '#333' : '#888'}
          />
        </Pressable>
        <Pressable style={styles.removeBtn} onPress={onRemove} hitSlop={6}>
          <Ionicons name="close-circle-outline" size={20} color="#ff6b6b" />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: {
    color: '#555',
    fontSize: 17,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#444',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  separator: {
    height: 1,
    backgroundColor: '#1c1c1e',
    marginLeft: 76,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: '#0a0a0a',
  },
  rowPressed: { backgroundColor: '#111' },
  position: {
    color: '#444',
    fontSize: 13,
    fontWeight: '600',
    width: 20,
    textAlign: 'center',
  },
  cover: {
    width: 44,
    height: 66,
    borderRadius: 4,
  },
  info: { flex: 1, gap: 3 },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  authors: { color: '#888', fontSize: 12 },
  format: {
    color: '#444',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actions: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  arrowBtn: { padding: 4 },
  arrowBtnDisabled: { opacity: 0.3 },
  removeBtn: { padding: 4, marginTop: 2 },
});
