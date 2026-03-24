import { useState, useEffect } from 'react';
import {
  Stack,
  TextInput,
  NumberInput,
  PasswordInput,
  Switch,
  Button,
  Group,
  Alert,
  Text,
} from '@mantine/core';
import {
  IconCheck,
  IconAlertTriangle,
  IconPlugConnected,
  IconTrash,
} from '@tabler/icons-react';
import axios from 'axios';
import { api } from '../utils/api';

interface SmtpConfig {
  host: string;
  port: number;
  fromAddress: string;
  username: string;
  passwordHint: string;
  enableAuth: boolean;
  enableStartTls: boolean;
}

interface SmtpForm {
  host: string;
  port: number;
  fromAddress: string;
  username: string;
  password: string;
  enableAuth: boolean;
  enableStartTls: boolean;
}

interface TestResult {
  success: boolean;
  error?: string;
}

interface SmtpConfigFormProps {
  /** API path to GET/PUT/DELETE the config, e.g. '/settings/smtp' or '/users/me/smtp' */
  configPath: string;
  /** API path to POST a test, e.g. '/settings/smtp/test' or '/users/me/smtp/test' */
  testPath: string;
}

const DEFAULT_FORM: SmtpForm = {
  host: '',
  port: 587,
  fromAddress: '',
  username: '',
  password: '',
  enableAuth: true,
  enableStartTls: true,
};

export function SmtpConfigForm({ configPath, testPath }: SmtpConfigFormProps) {
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [form, setForm] = useState<SmtpForm>(DEFAULT_FORM);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(
    null,
  );
  const [saveError, setSaveError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .get<SmtpConfig>(configPath)
      .then((r) => {
        setConfig(r.data);
        setForm({
          host: r.data.host,
          port: r.data.port,
          fromAddress: r.data.fromAddress,
          username: r.data.username,
          password: '',
          enableAuth: r.data.enableAuth,
          enableStartTls: r.data.enableStartTls,
        });
      })
      .catch(() => {
        // 404 = not configured yet; start with blank form
      });
  }, [configPath]);

  function set<K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaveResult(null);
    setTestResult(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    setSaveError('');
    try {
      const payload: Partial<SmtpForm> = { ...form };
      if (!passwordChanged) delete payload.password;

      const res = await api.put<SmtpConfig>(configPath, payload);
      setConfig(res.data);
      setPasswordChanged(false);
      setForm((f) => ({ ...f, password: '' }));
      setSaveResult('success');
    } catch (e) {
      const msg = axios.isAxiosError(e) && e.response?.data?.message;
      setSaveError(
        typeof msg === 'string' ? msg : 'Failed to save SMTP configuration.',
      );
      setSaveResult('error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(configPath);
      setConfig(null);
      setForm(DEFAULT_FORM);
      setPasswordChanged(false);
      setConfirmDelete(false);
      setSaveResult(null);
      setTestResult(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: Partial<SmtpForm> = { ...form };
      if (!passwordChanged) delete payload.password;
      const res = await api.post<TestResult>(testPath, payload);
      setTestResult(res.data);
    } catch (e) {
      const msg = axios.isAxiosError(e) && e.response?.data?.message;
      setTestResult({
        success: false,
        error: typeof msg === 'string' ? msg : 'Request failed.',
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Stack gap="sm">
      <TextInput
        label="SMTP Host"
        placeholder="smtp.gmail.com"
        value={form.host}
        onChange={(e) => set('host', e.currentTarget.value)}
      />
      <NumberInput
        label="Port"
        placeholder="587"
        value={form.port}
        onChange={(v) => set('port', Number(v))}
        min={1}
        max={65535}
      />
      <TextInput
        label="From Address"
        placeholder="you@example.com"
        value={form.fromAddress}
        onChange={(e) => set('fromAddress', e.currentTarget.value)}
      />
      <TextInput
        label="Username"
        placeholder="you@example.com"
        value={form.username}
        onChange={(e) => set('username', e.currentTarget.value)}
      />
      <PasswordInput
        label="Password"
        placeholder={config ? config.passwordHint : 'Enter password'}
        description={
          config && !passwordChanged
            ? 'Leave blank to keep current password'
            : undefined
        }
        value={form.password}
        onChange={(e) => {
          set('password', e.currentTarget.value);
          setPasswordChanged(true);
        }}
      />
      <Switch
        label="Enable authentication"
        checked={form.enableAuth}
        onChange={(e) => set('enableAuth', e.currentTarget.checked)}
      />
      <Switch
        label="Enable STARTTLS"
        checked={form.enableStartTls}
        onChange={(e) => set('enableStartTls', e.currentTarget.checked)}
      />

      {testResult &&
        (testResult.success ? (
          <Alert icon={<IconCheck size={14} />} color="green" variant="light">
            Connection successful
          </Alert>
        ) : (
          <Alert
            icon={<IconAlertTriangle size={14} />}
            color="red"
            variant="light"
          >
            <Text size="sm">Connection failed: {testResult.error}</Text>
          </Alert>
        ))}

      {saveResult === 'success' && (
        <Alert icon={<IconCheck size={14} />} color="green" variant="light">
          SMTP configuration saved
        </Alert>
      )}
      {saveResult === 'error' && (
        <Alert
          icon={<IconAlertTriangle size={14} />}
          color="red"
          variant="light"
        >
          {saveError}
        </Alert>
      )}

      <Group gap="xs">
        <Button
          leftSection={<IconPlugConnected size={14} />}
          variant="light"
          onClick={() => void handleTest()}
          loading={testing}
          disabled={!form.host || !form.fromAddress}
        >
          Test Connection
        </Button>
        <Button
          onClick={() => void handleSave()}
          loading={saving}
          disabled={!form.host || !form.fromAddress || !form.username}
        >
          Save
        </Button>
      </Group>

      {config && !confirmDelete && (
        <Button
          leftSection={<IconTrash size={14} />}
          variant="subtle"
          color="red"
          size="xs"
          onClick={() => setConfirmDelete(true)}
        >
          Remove configuration
        </Button>
      )}

      {confirmDelete && (
        <Alert
          icon={<IconAlertTriangle size={14} />}
          color="red"
          variant="light"
        >
          <Stack gap="xs">
            <Text size="sm">
              This will permanently delete the SMTP configuration. Are you sure?
            </Text>
            <Group gap="xs">
              <Button
                size="xs"
                color="red"
                loading={deleting}
                onClick={() => void handleDelete()}
              >
                Yes, remove it
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
