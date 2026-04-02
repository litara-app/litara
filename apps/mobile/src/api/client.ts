import axios from 'axios';
import { tokenStore } from '@/src/auth/tokenStore';
import { serverUrlStore } from '@/src/auth/serverUrlStore';

// Base URL is set dynamically per-request so changes to serverUrlStore
// are picked up without recreating the instance.
export const api = axios.create();

api.interceptors.request.use((config) => {
  const base = serverUrlStore.get();
  if (base) {
    config.baseURL = `${base}/api/v1`;
  }

  const token = tokenStore.get();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      tokenStore.set(null);
      // Navigation is handled by the drawer layout which watches token state.
    }
    return Promise.reject(error);
  },
);
