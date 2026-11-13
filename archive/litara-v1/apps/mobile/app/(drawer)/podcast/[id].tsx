import { Redirect, useLocalSearchParams } from 'expo-router';

export default function PodcastDetailRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/(drawer)/(tabs)/podcast/${id}`} />;
}
