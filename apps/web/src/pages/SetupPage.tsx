import { useState, useEffect } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import {
  TextInput,
  PasswordInput,
  Button,
  Paper,
  Title,
  Text,
  Alert,
  Stepper,
  Switch,
  Loader,
  Anchor,
  Badge,
  Stack,
  Group,
  Skeleton,
} from '@mantine/core';
import {
  IconMail,
  IconLock,
  IconUser,
  IconCheck,
  IconAlertTriangle,
  IconAlertCircle,
  IconInfoCircle,
  IconCircleCheck,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import { type MetadataProviderStatus } from '../components/MetadataSourcesSection';

const PROVIDER_COLORS: Record<string, string> = {
  hardcover: 'orange',
  'open-library': 'teal',
  'google-books': 'blue',
  goodreads: 'green',
};

const DISK_WRITES_DOCS = 'https://litara-app.github.io/litara/disk-writing';
const BOOK_DROP_DOCS =
  'https://litara-app.github.io/litara/configuration/book-drop';
const METADATA_DOCS = 'https://litara-app.github.io/litara/metadata-enrichment';

export function SetupPage() {
  const navigate = useNavigate();

  // Step control
  const [active, setActive] = useState(0);

  // Step 1 — disk status
  const [diskLoading, setDiskLoading] = useState(true);
  const [diskError, setDiskError] = useState('');
  const [isReadOnlyMount, setIsReadOnlyMount] = useState(false);
  const [bookDropConfigured, setBookDropConfigured] = useState(false);
  const [bookDropReachable, setBookDropReachable] = useState(false);
  const [wantDiskWrites, setWantDiskWrites] = useState(false);

  // Step 2 — account fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);

  // Step 3 — metadata providers
  const [providers, setProviders] = useState<MetadataProviderStatus[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState('');

  const fetchDiskStatus = () => {
    setDiskLoading(true);
    setDiskError('');
    api
      .get<{
        isReadOnlyMount: boolean;
        bookDropConfigured: boolean;
        bookDropReachable: boolean;
      }>('/setup/disk-status')
      .then((res) => {
        setIsReadOnlyMount(res.data.isReadOnlyMount);
        setBookDropConfigured(res.data.bookDropConfigured);
        setBookDropReachable(res.data.bookDropReachable);
      })
      .catch(() => {
        setDiskError(
          'Could not reach the server. Check that the backend is running.',
        );
      })
      .finally(() => setDiskLoading(false));
  };

  const fetchProviders = () => {
    setProvidersLoading(true);
    setProvidersError('');
    api
      .get<MetadataProviderStatus[]>('/admin/settings/metadata-providers')
      .then((res) => setProviders(res.data))
      .catch(() => setProvidersError('Failed to load metadata providers.'))
      .finally(() => setProvidersLoading(false));
  };

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

    fetchDiskStatus();
  }, [navigate]);

  useEffect(() => {
    if (active === 2) {
      fetchProviders();
    }
  }, [active]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmPassword !== password) {
      setSetupError('Passwords do not match.');
      return;
    }
    setSetupError('');
    setSetupLoading(true);
    try {
      const response = await api.post('/setup', {
        name: name.trim() || undefined,
        email,
        password,
      });
      localStorage.setItem('token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      if (wantDiskWrites) {
        try {
          await api.patch('/admin/settings/disk', { allowDiskWrites: true });
        } catch {
          console.warn(
            'Could not apply disk write setting — configure it later in Admin Settings.',
          );
        }
      }

      setActive(2);
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message;
      setSetupError(
        typeof message === 'string'
          ? message
          : 'Setup failed. Please try again.',
      );
    } finally {
      setSetupLoading(false);
    }
  };

  const emailInvalid = Boolean(
    email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  );
  const passwordTooShort = Boolean(password) && password.length < 8;
  const submitDisabled =
    setupLoading ||
    !email ||
    emailInvalid ||
    !password ||
    passwordTooShort ||
    (Boolean(confirmPassword) && confirmPassword !== password);

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
          width: 640,
          maxWidth: '96vw',
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
            Let's get your instance set up
          </Text>
        </div>

        <Stepper active={active} allowNextStepsSelect={false} size="sm">
          {/* ── Step 1: Library Check ── */}
          <Stepper.Step label="Library Check" description="Disk access">
            <Stack mt="md" gap="md">
              {diskLoading ? (
                <Stack align="center" gap="xs" py="xl">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">
                    Checking library access…
                  </Text>
                </Stack>
              ) : diskError ? (
                <Stack gap="sm">
                  <Alert
                    color="red"
                    icon={<IconAlertCircle size={16} />}
                    title="Connection error"
                  >
                    {diskError}
                  </Alert>
                  <Button variant="light" size="sm" onClick={fetchDiskStatus}>
                    Retry
                  </Button>
                </Stack>
              ) : (
                <>
                  {/* Section A — Library write access */}
                  {isReadOnlyMount ? (
                    <Alert
                      color="yellow"
                      icon={<IconAlertTriangle size={16} />}
                      title="Library is mounted read-only"
                    >
                      <Text size="sm">
                        Your ebook library volume is mounted read-only. Write
                        operations (sidecar files, metadata write-back) will not
                        be available. To enable them, update your docker-compose
                        volume mount to remove the <code>:ro</code> flag and
                        restart.{' '}
                        <Anchor
                          href={DISK_WRITES_DOCS}
                          target="_blank"
                          size="sm"
                        >
                          Learn more
                        </Anchor>
                      </Text>
                    </Alert>
                  ) : (
                    <Stack gap="xs">
                      <Switch
                        label="Enable write operations"
                        checked={wantDiskWrites}
                        onChange={(e) =>
                          setWantDiskWrites(e.currentTarget.checked)
                        }
                      />
                      <Text size="sm" c="dimmed">
                        Allows Litara to write <code>.metadata.json</code>{' '}
                        sidecar files alongside your ebooks. Ebook files are
                        never modified. You can change this later in Admin
                        Settings.{' '}
                        <Anchor
                          href={DISK_WRITES_DOCS}
                          target="_blank"
                          size="sm"
                        >
                          Learn more
                        </Anchor>
                      </Text>
                    </Stack>
                  )}

                  {/* Section B — Book drop status */}
                  {!bookDropConfigured ? (
                    <Alert
                      color="blue"
                      icon={<IconInfoCircle size={16} />}
                      title="Book drop not configured"
                    >
                      <Text size="sm">
                        Book drop lets users upload ebooks for admin review. Set
                        the <code>BOOK_DROP_PATH</code> environment variable to
                        enable it.{' '}
                        <Anchor href={BOOK_DROP_DOCS} target="_blank" size="sm">
                          Learn more
                        </Anchor>
                      </Text>
                    </Alert>
                  ) : bookDropConfigured && !bookDropReachable ? (
                    <Alert
                      color="orange"
                      icon={<IconAlertTriangle size={16} />}
                      title="Book drop directory not found"
                    >
                      <Text size="sm">
                        <code>BOOK_DROP_PATH</code> is set but the directory was
                        not found on disk. Check your volume mount.{' '}
                        <Anchor href={BOOK_DROP_DOCS} target="_blank" size="sm">
                          Learn more
                        </Anchor>
                      </Text>
                    </Alert>
                  ) : (
                    <Alert
                      color="green"
                      icon={<IconCircleCheck size={16} />}
                      title="Book drop enabled"
                    >
                      <Text size="sm">
                        Book drop is enabled and the folder is accessible. Write
                        operations are required to perform admin review actions
                        to write files to the main library.
                      </Text>
                    </Alert>
                  )}

                  <Button
                    mt="xs"
                    onClick={() => setActive(1)}
                    leftSection={<IconCheck size={16} />}
                    disabled={isReadOnlyMount === undefined}
                  >
                    {isReadOnlyMount ? 'I understand, Continue' : 'Continue'}
                  </Button>
                </>
              )}
            </Stack>
          </Stepper.Step>

          {/* ── Step 2: Admin Account ── */}
          <Stepper.Step label="Admin Account" description="Create login">
            <form onSubmit={(e) => void handleSetup(e)}>
              <Stack mt="md" gap="md">
                <TextInput
                  label="Name"
                  placeholder="Your name (optional)"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  leftSection={<IconUser size={16} />}
                />
                <TextInput
                  label="Email"
                  placeholder="you@example.dev"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  leftSection={<IconMail size={16} />}
                  error={
                    emailInvalid ? 'Enter a valid email address' : undefined
                  }
                />
                <PasswordInput
                  label="Password"
                  placeholder="Choose a strong password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  leftSection={<IconLock size={16} />}
                  error={
                    password && password.length < 8
                      ? 'Password must be at least 8 characters'
                      : undefined
                  }
                  description="Minimum 8 characters"
                />
                <PasswordInput
                  label="Confirm Password"
                  placeholder="Repeat your password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                  leftSection={<IconLock size={16} />}
                  error={
                    confirmPassword && confirmPassword !== password
                      ? 'Passwords do not match'
                      : undefined
                  }
                />
                <Button
                  type="submit"
                  loading={setupLoading}
                  disabled={submitDisabled}
                  leftSection={<IconCheck size={16} />}
                >
                  Create Admin Account
                </Button>
                {setupError && (
                  <Alert color="red" icon={<IconAlertCircle size={16} />}>
                    {setupError}
                  </Alert>
                )}
              </Stack>
            </form>
          </Stepper.Step>

          {/* ── Step 3: Metadata Overview ── */}
          <Stepper.Step label="Metadata" description="Provider overview">
            <Stack mt="md" gap="md">
              <Text size="sm" c="dimmed">
                Here's an overview of your metadata providers. You can enable or
                disable them later in Admin Settings.{' '}
                <Anchor href={METADATA_DOCS} target="_blank" size="sm">
                  Learn more
                </Anchor>
              </Text>

              {providersLoading ? (
                <Stack gap="xs">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} height={40} radius="sm" />
                  ))}
                </Stack>
              ) : providersError ? (
                <Stack gap="sm">
                  <Alert color="red" icon={<IconAlertCircle size={16} />}>
                    {providersError}
                  </Alert>
                  <Button variant="light" size="sm" onClick={fetchProviders}>
                    Retry
                  </Button>
                </Stack>
              ) : (
                <Stack gap={0}>
                  {providers.map((p) => {
                    const color = PROVIDER_COLORS[p.id] ?? 'gray';
                    return (
                      <Group
                        key={p.id}
                        justify="space-between"
                        py="sm"
                        style={{
                          borderBottom:
                            '1px solid var(--mantine-color-default-border)',
                        }}
                      >
                        <Group gap="sm">
                          <Badge
                            color={color}
                            variant="light"
                            size="sm"
                            miw={100}
                          >
                            {p.label}
                          </Badge>
                          {p.requiresApiKey && (
                            <Badge
                              size="xs"
                              variant="outline"
                              color={p.apiKeyConfigured ? 'green' : 'yellow'}
                            >
                              {p.apiKeyConfigured
                                ? 'API Key Set'
                                : 'No API Key'}
                            </Badge>
                          )}
                        </Group>
                        <Group gap="sm">
                          <Badge
                            size="xs"
                            variant="light"
                            color={p.enabled ? 'green' : 'gray'}
                          >
                            {p.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </Group>
                      </Group>
                    );
                  })}
                </Stack>
              )}

              <Text size="sm" c="dimmed" mt="xs">
                Configure metadata providers and other settings in{' '}
                <Anchor component={Link} to="/admin/settings" size="sm">
                  Admin Settings
                </Anchor>
                . Learn more in the{' '}
                <Anchor
                  href="https://litara-app.github.io/litara/metadata-enrichment"
                  target="_blank"
                  size="sm"
                >
                  Litara docs
                </Anchor>{' '}
                or visit the{' '}
                <Anchor
                  href="https://github.com/litara-app/litara"
                  target="_blank"
                  size="sm"
                >
                  GitHub repo
                </Anchor>
                .
              </Text>

              <Button
                fullWidth
                leftSection={<IconCheck size={16} />}
                onClick={() => navigate('/')}
              >
                Go to Dashboard
              </Button>
            </Stack>
          </Stepper.Step>
        </Stepper>
      </Paper>
    </div>
  );
}
