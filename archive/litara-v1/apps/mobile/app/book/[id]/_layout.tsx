import { Stack } from 'expo-router';

export default function BookDetailLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="search-metadata" />
      <Stack.Screen name="metadata-results" />
      <Stack.Screen name="metadata-compare" />
    </Stack>
  );
}
