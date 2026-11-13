import { Redirect } from 'expo-router';
import { useAuthContext } from '@/src/context/AuthContext';

export default function Index() {
  const { serverUrl, token, loading } = useAuthContext();

  if (loading) return null;
  if (!serverUrl) return <Redirect href="/server-setup" />;
  if (!token) return <Redirect href="/login" />;
  return <Redirect href="/(drawer)/(tabs)/" />;
}
