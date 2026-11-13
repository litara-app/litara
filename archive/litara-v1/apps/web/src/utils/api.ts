import axios, { AxiosError } from 'axios';
import { getDefaultStore } from 'jotai';
import { backendStatusAtom } from '../store/atoms';
import { pushToast } from './toast';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
});

const store = getDefaultStore();

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => {
    store.set(backendStatusAtom, 'ok');
    return response;
  },
  (error: AxiosError) => {
    const status = error.response?.status;
    if (!status || status >= 500) {
      store.set(backendStatusAtom, 'error');
    }
    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    if (status === 429) {
      pushToast(
        'Rate limit hit — metadata provider is throttling requests. Try again later.',
        {
          title: 'Rate Limited (429)',
          color: 'orange',
          duration: 8000,
        },
      );
    }
    return Promise.reject(error);
  },
);
