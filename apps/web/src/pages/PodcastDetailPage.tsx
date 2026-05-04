import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Title,
  Text,
  Paper,
  Group,
  Avatar,
  Badge,
  ActionIcon,
  Skeleton,
  Button,
  Modal,
  Select,
  NumberInput,
  Drawer,
  Alert,
  ScrollArea,
  Tooltip,
  Radio,
  Progress,
} from '@mantine/core';
import {
  IconMicrophone,
  IconPlayerPlay,
  IconDownload,
  IconSettings,
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconLoader,
  IconRefresh,
  IconTrash,
  IconArrowLeft,
} from '@tabler/icons-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { api } from '../utils/api';
import {
  podcastsEnabledAtom,
  podcastPlayerAtom,
  audiobookPlayerAtom,
} from '../store/atoms';

interface PodcastDetail {
  id: string;
  title: string;
  description: string | null;
  artworkUrl: string | null;
  author: string | null;
  lastRefreshedAt: string | null;
  episodeCount: number;
  refreshIntervalMinutes: number;
  downloadPolicy: 'ALL' | 'LATEST_N' | 'MANUAL';
  keepLatestN: number | null;
  retentionPolicy: 'KEEP_ALL' | 'DELETE_AFTER_LISTENED' | 'KEEP_LATEST_N';
  subscribed: boolean;
  feedUrl: string;
}

interface Episode {
  id: string;
  title: string;
  publishedAt: string | null;
  duration: number | null;
  downloadStatus:
    | 'NOT_DOWNLOADED'
    | 'PENDING'
    | 'DOWNLOADING'
    | 'DOWNLOADED'
    | 'FAILED';
  currentTime: number | null;
}

const STATUS_BADGE: Record<
  Episode['downloadStatus'],
  { color: string; label: string; icon: React.ReactNode }
> = {
  DOWNLOADED: {
    color: 'green',
    label: 'Downloaded',
    icon: <IconCheck size={12} />,
  },
  DOWNLOADING: {
    color: 'blue',
    label: 'Downloading',
    icon: <IconLoader size={12} />,
  },
  PENDING: { color: 'yellow', label: 'Pending', icon: <IconClock size={12} /> },
  NOT_DOWNLOADED: { color: 'gray', label: 'Not downloaded', icon: null },
  FAILED: {
    color: 'red',
    label: 'Failed',
    icon: <IconAlertTriangle size={12} />,
  },
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PodcastDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const podcastsEnabled = useAtomValue(podcastsEnabledAtom);
  const setPodcastPlayer = useSetAtom(podcastPlayerAtom);
  const setAudiobookPlayer = useSetAtom(audiobookPlayerAtom);

  const [podcast, setPodcast] = useState<PodcastDetail | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsForm, setSettingsForm] = useState({
    refreshIntervalMinutes: 60,
    downloadPolicy: 'ALL' as PodcastDetail['downloadPolicy'],
    keepLatestN: 10,
    retentionPolicy: 'KEEP_ALL' as PodcastDetail['retentionPolicy'],
  });

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteOption, setDeleteOption] = useState<'keep' | 'delete'>('keep');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [podcastRes, episodesRes] = await Promise.all([
      api.get<PodcastDetail>(`/podcasts/${id}`),
      api.get<{ episodes: Episode[] }>(`/podcasts/${id}/episodes`),
    ]);
    setPodcast(podcastRes.data);
    setEpisodes(episodesRes.data.episodes);
    setSettingsForm({
      refreshIntervalMinutes: podcastRes.data.refreshIntervalMinutes,
      downloadPolicy: podcastRes.data.downloadPolicy,
      keepLatestN: podcastRes.data.keepLatestN ?? 10,
      retentionPolicy: podcastRes.data.retentionPolicy,
    });
  }, [id]);

  useEffect(() => {
    if (!podcastsEnabled) {
      navigate('/');
      return;
    }
    load().finally(() => setLoading(false));
  }, [podcastsEnabled, navigate, load]);

  async function handleDownload(episodeId: string) {
    await api.post(`/podcasts/episodes/${episodeId}/download`);
    setEpisodes((prev) =>
      prev.map((e) =>
        e.id === episodeId ? { ...e, downloadStatus: 'PENDING' } : e,
      ),
    );
  }

  function handlePlay(episodeId: string) {
    if (!podcast) return;
    const ep = episodes.find((e) => e.id === episodeId);
    setAudiobookPlayer(null);
    setPodcastPlayer({
      episodeId,
      episodeTitle: ep?.title ?? 'Podcast Episode',
      podcastTitle: podcast.title,
      artworkUrl: podcast.artworkUrl,
      initialPosition: ep?.currentTime ?? undefined,
    });
    setPlayingId(null);
  }

  async function handleRefresh() {
    if (!podcast) return;
    setRefreshing(true);
    try {
      const [podcastRes, episodesRes] = await Promise.all([
        api.post<PodcastDetail>(`/podcasts/${podcast.id}/refresh`),
        api.get<{ episodes: Episode[] }>(`/podcasts/${podcast.id}/episodes`),
      ]);
      setPodcast(podcastRes.data);
      setEpisodes(episodesRes.data.episodes);
    } catch {
      // ignore — user can retry
    } finally {
      setRefreshing(false);
    }
  }

  async function handleUnsubscribe() {
    if (!podcast) return;
    setDeleting(true);
    try {
      await api.delete(`/podcasts/${podcast.id}`, {
        params: { deleteFiles: deleteOption === 'delete' ? 'true' : 'false' },
      });
      navigate('/podcasts');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveSettings() {
    if (!podcast) return;
    setSavingSettings(true);
    setSettingsError('');
    try {
      const res = await api.patch<PodcastDetail>(
        `/podcasts/${podcast.id}`,
        settingsForm,
      );
      setPodcast(res.data);
      setSettingsOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save settings.';
      setSettingsError(msg);
    } finally {
      setSavingSettings(false);
    }
  }

  if (loading) {
    return (
      <Stack gap="md">
        <Skeleton height={100} radius="md" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} height={60} radius="md" />
        ))}
      </Stack>
    );
  }

  if (!podcast) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={16} />}>
        Podcast not found.
      </Alert>
    );
  }

  return (
    <>
      <Stack gap="md">
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate('/podcasts')}
          w="fit-content"
          px={4}
        >
          All Podcasts
        </Button>

        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
              <Avatar
                src={podcast.artworkUrl}
                size={72}
                radius="sm"
                color="blue"
              >
                <IconMicrophone size={36} />
              </Avatar>
              <div style={{ minWidth: 0 }}>
                <Title order={3} lineClamp={2}>
                  {podcast.title}
                </Title>
                {podcast.author && (
                  <Text c="dimmed" size="sm">
                    {podcast.author}
                  </Text>
                )}
                {podcast.description && (
                  <Text size="sm" lineClamp={2} mt={4}>
                    {podcast.description}
                  </Text>
                )}
                <Group gap="xs" mt={6}>
                  <Badge variant="light">{podcast.episodeCount} episodes</Badge>
                  {podcast.lastRefreshedAt && (
                    <Text size="xs" c="dimmed">
                      Updated{' '}
                      {new Date(podcast.lastRefreshedAt).toLocaleDateString()}
                    </Text>
                  )}
                </Group>
              </div>
            </Group>
            <Group gap="xs" wrap="nowrap">
              {podcast.subscribed && (
                <Tooltip label="Refresh feed">
                  <ActionIcon
                    variant="subtle"
                    size="lg"
                    loading={refreshing}
                    onClick={() => void handleRefresh()}
                  >
                    <IconRefresh size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => setSettingsOpen(true)}
              >
                <IconSettings size={18} />
              </ActionIcon>
              <Tooltip label="Unsubscribe">
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size="lg"
                  onClick={() => {
                    setDeleteOption('keep');
                    setDeleteOpen(true);
                  }}
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Paper>

        <Title order={4}>Episodes</Title>

        {episodes.length === 0 ? (
          <Text c="dimmed">No episodes yet.</Text>
        ) : (
          <ScrollArea>
            <Stack gap="xs">
              {episodes.map((ep) => {
                const status = STATUS_BADGE[ep.downloadStatus];
                return (
                  <Paper key={ep.id} withBorder p="sm" radius="md">
                    <Group justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Text fw={500} size="sm" lineClamp={2}>
                          {ep.title}
                        </Text>
                        <Group gap="xs" mt={2}>
                          {ep.publishedAt && (
                            <Text size="xs" c="dimmed">
                              {new Date(ep.publishedAt).toLocaleDateString()}
                            </Text>
                          )}
                          {ep.downloadStatus === 'DOWNLOADED' &&
                          (ep.currentTime ?? 0) > 0 &&
                          ep.duration ? (
                            <Text size="xs" c="blue.4">
                              {formatDuration(ep.currentTime!)} /{' '}
                              {formatDuration(ep.duration)}
                            </Text>
                          ) : ep.duration ? (
                            <Text size="xs" c="dimmed">
                              {formatDuration(ep.duration)}
                            </Text>
                          ) : null}
                          <Badge
                            size="xs"
                            color={status.color}
                            leftSection={status.icon}
                            variant="light"
                          >
                            {status.label}
                          </Badge>
                        </Group>
                        {ep.downloadStatus === 'DOWNLOADED' &&
                        (ep.currentTime ?? 0) > 0 &&
                        ep.duration ? (
                          <Progress
                            value={Math.min(
                              (ep.currentTime! / ep.duration) * 100,
                              100,
                            )}
                            size={3}
                            mt={6}
                            radius="xl"
                          />
                        ) : null}
                      </div>
                      <Group gap="xs" wrap="nowrap">
                        <Tooltip
                          label="Play"
                          disabled={ep.downloadStatus !== 'DOWNLOADED'}
                        >
                          <ActionIcon
                            variant="subtle"
                            color="blue"
                            disabled={ep.downloadStatus !== 'DOWNLOADED'}
                            loading={playingId === ep.id}
                            onClick={() => handlePlay(ep.id)}
                          >
                            <IconPlayerPlay size={16} />
                          </ActionIcon>
                        </Tooltip>
                        {ep.downloadStatus !== 'DOWNLOADED' &&
                          ep.downloadStatus !== 'DOWNLOADING' &&
                          ep.downloadStatus !== 'PENDING' && (
                            <Tooltip label="Download">
                              <ActionIcon
                                variant="subtle"
                                onClick={() => void handleDownload(ep.id)}
                              >
                                <IconDownload size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                      </Group>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          </ScrollArea>
        )}
      </Stack>

      <Modal
        opened={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        title="Unsubscribe from podcast"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Unsubscribing from <strong>{podcast.title}</strong>. What should
            happen to downloaded episodes?
          </Text>
          <Radio.Group
            value={deleteOption}
            onChange={(v) => setDeleteOption(v as 'keep' | 'delete')}
          >
            <Stack gap="xs">
              <Radio
                value="keep"
                label="Keep downloaded files"
                description="Unsubscribe but keep any downloaded episode files"
              />
              <Radio
                value="delete"
                label="Delete downloaded files"
                description="Unsubscribe and remove all downloaded episode files from disk"
              />
            </Stack>
          </Radio.Group>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={deleting}
              onClick={() => void handleUnsubscribe()}
            >
              Unsubscribe
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Drawer
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Podcast Settings"
        position="right"
        size="md"
      >
        <Stack gap="md">
          <NumberInput
            label="Refresh interval (minutes)"
            description="How often to check for new episodes. Min 15, max 10080 (1 week)."
            value={settingsForm.refreshIntervalMinutes}
            onChange={(v) =>
              setSettingsForm((f) => ({
                ...f,
                refreshIntervalMinutes: Number(v),
              }))
            }
            min={15}
            max={10080}
          />

          <Select
            label="Download policy"
            value={settingsForm.downloadPolicy}
            onChange={(v) =>
              v &&
              setSettingsForm((f) => ({
                ...f,
                downloadPolicy: v as PodcastDetail['downloadPolicy'],
              }))
            }
            data={[
              { value: 'ALL', label: 'Download all new episodes' },
              { value: 'LATEST_N', label: 'Download latest N episodes' },
              { value: 'MANUAL', label: 'Manual only' },
            ]}
          />

          {settingsForm.downloadPolicy === 'LATEST_N' && (
            <NumberInput
              label="Number of episodes to download"
              value={settingsForm.keepLatestN}
              onChange={(v) =>
                setSettingsForm((f) => ({ ...f, keepLatestN: Number(v) }))
              }
              min={1}
            />
          )}

          <Select
            label="Retention policy"
            value={settingsForm.retentionPolicy}
            onChange={(v) =>
              v &&
              setSettingsForm((f) => ({
                ...f,
                retentionPolicy: v as PodcastDetail['retentionPolicy'],
              }))
            }
            data={[
              { value: 'KEEP_ALL', label: 'Keep all downloaded episodes' },
              {
                value: 'DELETE_AFTER_LISTENED',
                label: 'Delete after listening (95%+)',
              },
              {
                value: 'KEEP_LATEST_N',
                label: 'Keep latest N downloaded only',
              },
            ]}
          />

          {settingsError && (
            <Alert color="red" icon={<IconAlertTriangle size={14} />}>
              {settingsError}
            </Alert>
          )}

          <Button
            onClick={() => void handleSaveSettings()}
            loading={savingSettings}
          >
            Save Settings
          </Button>
        </Stack>
      </Drawer>
    </>
  );
}
