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
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import axios from 'axios';
import { useAuthContext } from '@/src/context/AuthContext';

function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, ''); // strip trailing slashes
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

async function verifyServer(baseUrl: string): Promise<void> {
  // A lightweight check — just needs to respond with the right shape
  const res = await axios.get(`${baseUrl}/api/v1/setup/status`, {
    timeout: 8000,
  });
  if (typeof res.data?.setupRequired !== 'boolean') {
    throw new Error('Unexpected response from server');
  }
}

export default function ServerSetupScreen() {
  const { serverUrl, loading, setServerUrl } = useAuthContext();
  const { change } = useLocalSearchParams<{ change?: string }>();
  const isChanging = change === '1';
  const [url, setUrl] = useState(isChanging ? (serverUrl ?? '') : '');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  if (loading) return null;
  if (serverUrl && !isChanging) return <Redirect href="/login" />;

  const handleConnect = async () => {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    setError('');
    setChecking(true);
    try {
      await verifyServer(normalized);
      await setServerUrl(normalized);
      router.replace('/login');
    } catch {
      setError('Could not reach the server. Check the address and try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Litara</Text>
        <Text style={styles.subtitle}>Connect to your server</Text>

        <Text style={styles.label}>Server address</Text>
        <TextInput
          style={styles.input}
          placeholder="192.168.1.100:3000"
          placeholderTextColor="#555"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleConnect}
        />
        <Text style={styles.hint}>
          The address of your Litara instance. Include the port if not on
          80/443.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, checking && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={checking || !url.trim()}
        >
          {checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </Pressable>

        {isChanging && (
          <Pressable style={styles.cancelButton} onPress={() => router.back()}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        )}
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
    gap: 10,
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
    marginBottom: 8,
  },
  label: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
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
  hint: {
    color: '#555',
    fontSize: 12,
    lineHeight: 16,
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
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelText: {
    color: '#888',
    fontSize: 15,
  },
});
