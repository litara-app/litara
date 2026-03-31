import { useState } from 'react';
import {
  Title,
  Stack,
  Paper,
  Text,
  PasswordInput,
  Button,
  Alert,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import axios from 'axios';
import { api } from '../utils/api';

export function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const passwordMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit() {
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword !== confirmPassword) return;

    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      await api.patch('/users/me/password', { currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      const msg = axios.isAxiosError(e) && e.response?.data?.message;
      setError(typeof msg === 'string' ? msg : 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Change Password</Title>
        <Text size="sm" c="dimmed">
          Update your login password. You will need to enter your current
          password to confirm.
        </Text>

        <PasswordInput
          label="Current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.currentTarget.value)}
          autoComplete="current-password"
        />
        <PasswordInput
          label="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.currentTarget.value)}
          autoComplete="new-password"
        />
        <PasswordInput
          label="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.currentTarget.value)}
          autoComplete="new-password"
          error={passwordMismatch ? 'Passwords do not match' : undefined}
        />

        {error && (
          <Alert
            icon={<IconAlertTriangle size={14} />}
            color="red"
            variant="light"
          >
            {error}
          </Alert>
        )}

        {success && (
          <Alert icon={<IconCheck size={14} />} color="green" variant="light">
            Password changed successfully.
          </Alert>
        )}

        <Button
          onClick={() => void handleSubmit()}
          loading={loading}
          disabled={
            !currentPassword ||
            !newPassword ||
            !confirmPassword ||
            passwordMismatch
          }
          w="fit-content"
        >
          Change password
        </Button>
      </Stack>
    </Paper>
  );
}
