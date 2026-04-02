import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { secureStorage } from '@/src/auth/storage';
import { tokenStore } from '@/src/auth/tokenStore';
import { serverUrlStore } from '@/src/auth/serverUrlStore';

const TOKEN_KEY = 'litara_token';
const SERVER_URL_KEY = 'litara_server_url';

interface AuthContextValue {
  serverUrl: string | null;
  token: string | null;
  loading: boolean;
  setServerUrl: (url: string) => Promise<void>;
  clearServerUrl: () => Promise<void>;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      secureStorage.getItemAsync(SERVER_URL_KEY),
      secureStorage.getItemAsync(TOKEN_KEY),
    ]).then(([url, tok]) => {
      serverUrlStore.set(url);
      setServerUrlState(url);
      tokenStore.set(tok);
      setTokenState(tok);
      setLoading(false);
    });
  }, []);

  const setServerUrl = async (url: string) => {
    await secureStorage.setItemAsync(SERVER_URL_KEY, url);
    serverUrlStore.set(url);
    setServerUrlState(url);
  };

  const clearServerUrl = async () => {
    await secureStorage.deleteItemAsync(SERVER_URL_KEY);
    serverUrlStore.set(null);
    setServerUrlState(null);
  };

  const setToken = async (newToken: string) => {
    await secureStorage.setItemAsync(TOKEN_KEY, newToken);
    tokenStore.set(newToken);
    setTokenState(newToken);
  };

  const clearToken = async () => {
    await secureStorage.deleteItemAsync(TOKEN_KEY);
    tokenStore.set(null);
    setTokenState(null);
  };

  return (
    <AuthContext.Provider
      value={{
        serverUrl,
        token,
        loading,
        setServerUrl,
        clearServerUrl,
        setToken,
        clearToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
