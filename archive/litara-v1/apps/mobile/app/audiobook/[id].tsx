import { useLocalSearchParams } from 'expo-router';
import { AudiobookPlayerScreen } from '@/src/screens/AudiobookPlayerScreen';

export default function AudiobookRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AudiobookPlayerScreen bookId={id!} />;
}
