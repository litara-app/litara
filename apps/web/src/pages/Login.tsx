import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TextInput,
  PasswordInput,
  Button,
  Paper,
  Title,
  Text,
  Alert,
} from '@mantine/core';
import { IconMail, IconLock, IconLogin } from '@tabler/icons-react';
import axios from 'axios';
import { api } from '../utils/api';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get('/setup/status')
      .then((res) => {
        if (res.data.setupRequired) {
          navigate('/setup', { replace: true });
        }
      })
      .catch(() => {});
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      navigate('/');
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message;
      setError(
        typeof message === 'string'
          ? message
          : 'Failed to login. Please check your credentials.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-8))',
        backgroundImage:
          'radial-gradient(circle, light-dark(var(--mantine-color-gray-4), var(--mantine-color-dark-5)) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <Paper
        shadow="xl"
        radius="md"
        p="xl"
        style={{
          width: 480,
          maxWidth: '95vw',
          borderTop: '4px solid var(--mantine-color-blue-6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <img src="/logo.svg" alt="Litara logo" width={56} height={56} />
          <Title order={2} fw={700} ta="center" mt="sm">
            Welcome to Litara
          </Title>
          <Text c="dimmed" ta="center" mt={4}>
            Sign in to your library
          </Text>
        </div>

        <form onSubmit={handleLogin}>
          <TextInput
            label="Email"
            placeholder="you@example.dev"
            required
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            leftSection={<IconMail size={16} />}
            error={
              email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                ? 'Enter a valid email address'
                : undefined
            }
          />
          <PasswordInput
            label="Password"
            placeholder="Your password"
            required
            mt="md"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            leftSection={<IconLock size={16} />}
          />
          <Button
            fullWidth
            mt="xl"
            type="submit"
            loading={loading}
            leftSection={<IconLogin size={16} />}
          >
            Sign in
          </Button>
          {error && (
            <Alert color="red" mt="md">
              {error}
            </Alert>
          )}
        </form>
      </Paper>
    </div>
  );
}
