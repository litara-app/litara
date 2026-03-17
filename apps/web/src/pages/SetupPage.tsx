import { useState, useEffect } from 'react';
import axios from 'axios';
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
import { IconMail, IconLock, IconUser, IconCheck } from '@tabler/icons-react';
import { api } from '../utils/api';

export function SetupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get('/setup/status')
      .then((res) => {
        if (!res.data.setupRequired) {
          navigate('/login', { replace: true });
        }
      })
      .catch(() => {
        navigate('/login', { replace: true });
      });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/setup', {
        name: name.trim() || undefined,
        email,
        password,
      });
      localStorage.setItem('token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      navigate('/');
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message;
      setError(
        typeof message === 'string'
          ? message
          : 'Setup failed. Please try again.',
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
        backgroundColor: '#eef0f3',
        backgroundImage:
          'radial-gradient(circle, #b8bcc6 1px, transparent 1px)',
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
          backgroundColor: '#ffffff',
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
            Create your admin account to get started
          </Text>
        </div>

        <form onSubmit={handleSubmit}>
          <TextInput
            label="Name"
            placeholder="Your name (optional)"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            leftSection={<IconUser size={16} />}
          />
          <TextInput
            label="Email"
            placeholder="you@example.dev"
            required
            mt="md"
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
            placeholder="Choose a strong password"
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
            leftSection={<IconCheck size={16} />}
          >
            Create Admin Account
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
