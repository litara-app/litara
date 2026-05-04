import { useLocalSearchParams } from 'expo-router';
import { PodcastPlayerScreen } from '@/src/screens/PodcastPlayerScreen';

export default function PodcastPlayerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PodcastPlayerScreen episodeId={id!} />;
}
