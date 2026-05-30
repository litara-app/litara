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
  IconHeadphones,
  IconFolder,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import { type MetadataProviderStatus } from '../components/MetadataSourcesSection';
import { FolderBrowserModal } from '../components/FolderBrowserModal';

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
  const [libraryRoot, setLibraryRoot] = useState('/books');

  // Step 2 — account fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);

  // Step 3 — first library
  const [libraryName, setLibraryName] = useState('My Library');
  const [libraryPath, setLibraryPath] = useState('');
  const [libraryCreating, setLibraryCreating] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);

  // Step 4 — metadata providers
  const [providers, setProviders] = useState<MetadataProviderStatus[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState('');

  // Step 4 — KOReader sync
  const [koReaderEnabled, setKoReaderEnabled] = useState(false);
  const [koReaderSaving, setKoReaderSaving] = useState(false);

  // Step 5 — Podcasts
  const [podcastsEnabled, setPodcastsEnabled] = useState(false);
  const [podcastsSaving, setPodcastsSaving] = useState(false);
  const [podcastsError, setPodcastsError] = useState(false);

  const fetchDiskStatus = () => {
    setDiskLoading(true);
    setDiskError('');
    api
      .get<{
        isReadOnlyMount: boolean;
        bookDropConfigured: boolean;
        bookDropReachable: boolean;
        libraryRoot: string;
      }>('/setup/disk-status')
      .then((res) => {
        setIsReadOnlyMount(res.data.isReadOnlyMount);
        setBookDropConfigured(res.data.bookDropConfigured);
        setBookDropReachable(res.data.bookDropReachable);
        setLibraryRoot(res.data.libraryRoot);
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
    if (active === 3) {
      fetchProviders();
    }
    if (active === 4) {
      api
        .get<{ enabled: boolean }>('/admin/settings/koreader')
        .then((r) => setKoReaderEnabled(r.data.enabled))
        .catch(() => {});
    }
    if (active === 5) {
      api
        .get<{ enabled: boolean }>('/podcasts/settings')
        .then((r) => setPodcastsEnabled(r.data.enabled))
        .catch(() => {});
    }
  }, [active]);

  async function handleCreateFirstLibrary() {
    setLibraryCreating(true);
    setLibraryError('');
    try {
      await api.post('/setup/first-library', {
        name: libraryName,
        path: libraryPath,
      });
      setActive((prev) => prev + 1);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to create library';
      setLibraryError(msg);
    } finally {
      setLibraryCreating(false);
    }
  }

  const handlePodcastsToggle = async (checked: boolean) => {
    setPodcastsSaving(true);
    setPodcastsError(false);
    try {
      await api.patch('/podcasts/settings', { enabled: checked });
      setPodcastsEnabled(checked);
    } catch {
      setPodcastsError(true);
    } finally {
      setPodcastsSaving(false);
    }
  };

  const handleKoReaderToggle = async (checked: boolean) => {
    setKoReaderSaving(true);
    try {
      await api.patch('/admin/settings/koreader', { enabled: checked });
      setKoReaderEnabled(checked);
    } catch {
      // ignore — user can change in admin settings later
    } finally {
      setKoReaderSaving(false);
    }
  };

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

          {/* ── Step 3: First Library ── */}
          <Stepper.Step label="First Library" description="Define your library">
            <Stack mt="md" gap="md">
              <Text size="sm" c="dimmed">
                Define your first library — a folder inside your{' '}
                <code>EBOOK_LIBRARY_PATH</code> that Litara will scan for books.
                You can skip this and set it up later in Admin Settings.
              </Text>
              <TextInput
                label="Library Name"
                value={libraryName}
                onChange={(e) => setLibraryName(e.currentTarget.value)}
              />
              <TextInput
                label="Folder Path (absolute)"
                description={`Must be inside EBOOK_LIBRARY_PATH (${libraryRoot}) on the server`}
                placeholder={libraryRoot}
                value={libraryPath}
                onChange={(e) => setLibraryPath(e.currentTarget.value)}
                rightSectionWidth={110}
                rightSection={
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconFolder size={14} />}
                    onClick={() => setFolderBrowserOpen(true)}
                    style={{ marginRight: 4 }}
                  >
                    Browse
                  </Button>
                }
              />
              {libraryError && (
                <Alert color="red" variant="light">
                  {libraryError}
                </Alert>
              )}
              <FolderBrowserModal
                opened={folderBrowserOpen}
                onClose={() => setFolderBrowserOpen(false)}
                onSelect={(relPath) => {
                  setLibraryPath(
                    relPath
                      ? `${libraryRoot.replace(/\/+$/, '')}/${relPath}`
                      : libraryRoot,
                  );
                }}
                libraryRoot={libraryRoot}
              />
              <Group>
                <Button
                  onClick={() => void handleCreateFirstLibrary()}
                  loading={libraryCreating}
                  disabled={!libraryName || !libraryPath}
                >
                  Create Library &amp; Continue
                </Button>
                <Button
                  variant="subtle"
                  onClick={() => setActive((prev) => prev + 1)}
                >
                  Skip
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>

          {/* ── Step 4: Metadata Overview ── */}
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
                onClick={() => setActive(4)}
              >
                Continue
              </Button>
            </Stack>
          </Stepper.Step>

          {/* ── Step 5: KOReader Sync ── */}
          <Stepper.Step label="KOReader" description="Device sync">
            <Stack mt="md" gap="md">
              <Text size="sm" c="dimmed">
                Litara can act as a KOReader Sync Server, keeping your reading
                position in sync across all your KOReader devices (Kindle, Kobo,
                Android). You can enable or disable this at any time in Admin
                Settings.
              </Text>

              <Switch
                label="Enable KOReader sync"
                checked={koReaderEnabled}
                onChange={(e) =>
                  void handleKoReaderToggle(e.currentTarget.checked)
                }
                disabled={koReaderSaving}
              />

              {koReaderEnabled && (
                <Alert
                  color="blue"
                  icon={<IconInfoCircle size={16} />}
                  title="Setup instructions"
                >
                  <Text size="sm">
                    In KOReader, go to{' '}
                    <strong>Tools → KOReader Sync → Custom sync server</strong>{' '}
                    and enter your Litara URL as the custom server. Users must
                    first create their KOReader credentials in{' '}
                    <strong>Settings → KOReader Sync</strong> before connecting.
                  </Text>
                </Alert>
              )}

              <Button
                fullWidth
                leftSection={<IconCheck size={16} />}
                onClick={() => setActive(5)}
              >
                Continue
              </Button>
            </Stack>
          </Stepper.Step>

          {/* ── Step 6: Podcasts ── */}
          <Stepper.Step label="Podcasts" description="Enable subscriptions">
            <Stack mt="md" gap="md">
              <Text size="sm" c="dimmed">
                Litara can subscribe to podcast RSS feeds and automatically
                download episodes for offline archiving and playback. You can
                enable or disable this at any time in Admin Settings.
              </Text>

              <Switch
                label="Enable podcasts"
                checked={podcastsEnabled}
                onChange={(e) =>
                  void handlePodcastsToggle(e.currentTarget.checked)
                }
                disabled={podcastsSaving}
              />

              {podcastsError && (
                <Alert color="red" icon={<IconAlertCircle size={16} />}>
                  Failed to save podcast setting. You can change it later in
                  Admin Settings.
                </Alert>
              )}

              {podcastsEnabled && (
                <Alert
                  color="blue"
                  icon={<IconHeadphones size={16} />}
                  title="Podcasts enabled"
                >
                  <Text size="sm">
                    Episode files are stored at the path configured by{' '}
                    <code>PODCAST_STORAGE_PATH</code> (default:{' '}
                    <code>/data/podcasts</code>). Subscribe to feeds from the
                    Podcasts page once you're logged in.
                  </Text>
                </Alert>
              )}

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
