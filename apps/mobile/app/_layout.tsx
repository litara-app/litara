import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { AuthProvider } from '@/src/context/AuthContext';
import { GridSizeProvider } from '@/src/context/GridSizeContext';

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
        <GridSizeProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="server-setup" />
            <Stack.Screen name="login" />
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen name="book/[id]" options={{ headerShown: false }} />
            <Stack.Screen
              name="series/[id]"
              options={{
                headerShown: true,
                headerStyle: { backgroundColor: '#0a0a0a' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontWeight: '700' },
              }}
            />
            <Stack.Screen
              name="author/[id]"
              options={{
                headerShown: true,
                headerStyle: { backgroundColor: '#0a0a0a' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontWeight: '700' },
              }}
            />
            <Stack.Screen name="read/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="search" options={{ headerShown: false }} />
          </Stack>
        </GridSizeProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}
