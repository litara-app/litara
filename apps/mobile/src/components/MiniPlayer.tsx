import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  State,
  useActiveTrack,
  usePlaybackState,
} from 'react-native-track-player';
import { serverUrlStore } from '@/src/auth/serverUrlStore';

function buildCoverUrl(bookId: string): string {
  const base = serverUrlStore.get() ?? '';
  return `${base}/api/v1/books/${bookId}/cover`;
}

export function MiniPlayer() {
  const track = useActiveTrack();
  const { state } = usePlaybackState();
  const router = useRouter();

  if (!track) return null;

  const bookId = track.id?.split(':')[1] ?? '';
  const isPlaying = state === State.Playing;

  const togglePlay = () => {
    if (isPlaying) void TrackPlayer.pause();
    else void TrackPlayer.play();
  };

  const stop = () => {
    void TrackPlayer.reset();
  };

  return (
    <Pressable
      style={styles.container}
      onPress={() => router.push(`/audiobook/${bookId}`)}
    >
      <Image
        source={{ uri: buildCoverUrl(bookId) }}
        style={styles.cover}
        contentFit="cover"
      />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {track.title ?? 'Unknown title'}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist ?? ''}
        </Text>
      </View>
      <TouchableOpacity onPress={togglePlay} style={styles.btn} hitSlop={8}>
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity onPress={stop} style={styles.btn} hitSlop={8}>
        <Ionicons name="close" size={22} color="#555" />
      </TouchableOpacity>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#2c2c2e',
    height: 64,
    paddingHorizontal: 12,
    gap: 10,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#1c1c1e',
  },
  info: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  artist: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  btn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
