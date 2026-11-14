import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { secureStorage } from '@/src/auth/storage';
import { tokenStore } from '@/src/auth/tokenStore';
import { serverUrlStore } from '@/src/auth/serverUrlStore';

const TOKEN_KEY = 'litara_token';
const SERVER_URL_KEY = 'litara_server_url';
const USER_KEY = 'litara_user';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
}

interface AuthContextValue {
  serverUrl: string | null;
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  setServerUrl: (url: string) => Promise<void>;
  clearServerUrl: () => Promise<void>;
  setToken: (token: string, user: AuthUser) => Promise<void>;
  clearToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      secureStorage.getItemAsync(SERVER_URL_KEY),
      secureStorage.getItemAsync(TOKEN_KEY),
      secureStorage.getItemAsync(USER_KEY),
    ]).then(([url, tok, userJson]) => {
      serverUrlStore.set(url);
      setServerUrlState(url);
      tokenStore.set(tok);
      setTokenState(tok);
      if (userJson) {
        try {
          setUserState(JSON.parse(userJson) as AuthUser);
        } catch {
          // ignore corrupt data
        }
      }
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

  const setToken = async (newToken: string, newUser: AuthUser) => {
    await Promise.all([
      secureStorage.setItemAsync(TOKEN_KEY, newToken),
      secureStorage.setItemAsync(USER_KEY, JSON.stringify(newUser)),
    ]);
    tokenStore.set(newToken);
    setTokenState(newToken);
    setUserState(newUser);
  };

  const clearToken = async () => {
    await Promise.all([
      secureStorage.deleteItemAsync(TOKEN_KEY),
      secureStorage.deleteItemAsync(USER_KEY),
    ]);
    tokenStore.set(null);
    setTokenState(null);
    setUserState(null);
  };

  // Keep a stable ref so the 401 interceptor always calls the latest clearToken
  // without needing to re-register on every render.
  const clearTokenRef = useRef(clearToken);
  clearTokenRef.current = clearToken;

  useEffect(() => {
    tokenStore.registerLogoutCallback(() => {
      void clearTokenRef.current();
    });
    return () => {
      tokenStore.registerLogoutCallback(null);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        serverUrl,
        token,
        user,
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
