import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { AuthProvider } from '@/src/context/AuthContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

export default function RootLayout() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="server-setup" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
          <Stack.Screen name="book/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="read/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="search" options={{ headerShown: false }} />
        </Stack>
      </QueryClientProvider>
    </AuthProvider>
  );
}
