import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { login } from '@/src/api/auth';
import { useAuthContext } from '@/src/context/AuthContext';

/** Litara logo — three stacked book spines, matching the web SVG. */
function LitaraLogo({ size = 72 }: { size?: number }) {
  const s = size / 56;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.logoRect,
          {
            left: 14 * s,
            top: 14 * s,
            width: 28 * s,
            height: 10 * s,
            borderRadius: 3 * s,
            backgroundColor: '#74c0fc',
          },
        ]}
      />
      <View
        style={[
          styles.logoRect,
          {
            left: 8 * s,
            top: 28 * s,
            width: 36 * s,
            height: 10 * s,
            borderRadius: 3 * s,
            backgroundColor: '#339af0',
          },
        ]}
      />
      <View
        style={[
          styles.logoRect,
          {
            left: 4 * s,
            top: 42 * s,
            width: 48 * s,
            height: 10 * s,
            borderRadius: 3 * s,
            backgroundColor: '#228be6',
          },
        ]}
      />
    </View>
  );
}

export default function LoginScreen() {
  const { serverUrl, token, loading, setToken } = useAuthContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (!serverUrl) return <Redirect href="/server-setup" />;
  if (token) return <Redirect href="/(tabs)" />;

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setError('');
    setSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      await setToken(result.access_token, result.user);
      router.replace('/(tabs)');
    } catch {
      setError('Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <View style={styles.logoRow}>
          <LitaraLogo size={72} />
        </View>
        <Text style={styles.title}>Litara</Text>
        <Text style={styles.subtitle}>Sign in to your library</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          onSubmitEditing={handleLogin}
          returnKeyType="go"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.changeServer}
          onPress={() =>
            router.push({ pathname: '/server-setup', params: { change: '1' } })
          }
        >
          <Text style={styles.changeServerUrl} numberOfLines={1}>
            {serverUrl}
          </Text>
          <Text style={styles.changeServerLink}>Change server</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  logoRow: {
    alignItems: 'center',
    marginBottom: 4,
  },
  logoRect: {
    position: 'absolute',
  },
  title: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#1c1c1e',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  error: {
    color: '#ff6b6b',
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#4a9eff',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  changeServer: {
    alignItems: 'center',
    marginTop: 24,
    gap: 6,
  },
  changeServerUrl: {
    color: '#aaa',
    fontSize: 15,
    fontWeight: '500',
  },
  changeServerLink: {
    color: '#4a9eff',
    fontSize: 15,
    fontWeight: '600',
  },
});
