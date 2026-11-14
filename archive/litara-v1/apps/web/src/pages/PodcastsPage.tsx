import { useState, useEffect } from 'react';
import {
  Stack,
  Title,
  Text,
  Button,
  Paper,
  Group,
  Avatar,
  Modal,
  TextInput,
  Alert,
  Skeleton,
  Badge,
  ActionIcon,
  Radio,
} from '@mantine/core';
import {
  IconMicrophone,
  IconPlus,
  IconTrash,
  IconAlertTriangle,
  IconExternalLink,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import axios from 'axios';
import { api } from '../utils/api';
import { podcastsEnabledAtom } from '../store/atoms';

interface Podcast {
  id: string;
  title: string;
  description: string | null;
  artworkUrl: string | null;
  author: string | null;
  feedUrl: string | null;
  lastRefreshedAt: string | null;
  episodeCount: number;
  subscribed: boolean;
}

export function PodcastsPage() {
  const navigate = useNavigate();
  const podcastsEnabled = useAtomValue(podcastsEnabledAtom);
  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Podcast | null>(null);
  const [deleteOption, setDeleteOption] = useState<'keep' | 'delete'>('keep');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!podcastsEnabled) {
      navigate('/');
      return;
    }
    api
      .get<Podcast[]>('/podcasts')
      .then((r) => setPodcasts(r.data))
      .finally(() => setLoading(false));
  }, [podcastsEnabled, navigate]);

  async function handleSubscribe() {
    if (!feedUrl.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await api.post<Podcast>('/podcasts', {
        feedUrl: feedUrl.trim(),
      });
      setPodcasts((prev) => {
        const exists = prev.find((p) => p.id === res.data.id);
        if (exists)
          return prev.map((p) => (p.id === res.data.id ? res.data : p));
        return [...prev, res.data];
      });
      setAddOpen(false);
      setFeedUrl('');
    } catch (e) {
      const message = axios.isAxiosError(e) && e.response?.data?.message;
      setAddError(
        typeof message === 'string' ? message : 'Failed to subscribe to feed.',
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/podcasts/${deleteTarget.id}`, {
        params: { deleteFiles: deleteOption === 'delete' ? 'true' : 'false' },
      });
      setPodcasts((prev) =>
        prev.map((p) =>
          p.id === deleteTarget.id ? { ...p, subscribed: false } : p,
        ),
      );
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleResubscribe(podcast: Podcast) {
    const res = await api.post<Podcast>('/podcasts', {
      feedUrl: podcast.feedUrl ?? '',
    });
    setPodcasts((prev) =>
      prev.map((p) => (p.id === res.data.id ? res.data : p)),
    );
  }

  if (loading) {
    return (
      <Stack gap="md">
        <Title order={2}>Podcasts</Title>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={80} radius="md" />
        ))}
      </Stack>
    );
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={2}>Podcasts</Title>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => setAddOpen(true)}
          >
            Add Podcast
          </Button>
        </Group>

        {podcasts.length === 0 ? (
          <Paper withBorder p="xl" radius="md" ta="center">
            <IconMicrophone size={48} opacity={0.3} />
            <Text mt="sm" c="dimmed">
              No podcasts yet. Add one to get started.
            </Text>
          </Paper>
        ) : (
          podcasts.map((podcast) => (
            <Paper
              key={podcast.id}
              withBorder
              p="md"
              radius="md"
              style={{
                cursor:
                  podcast.subscribed || podcast.feedUrl?.startsWith('local://')
                    ? 'pointer'
                    : 'default',
                opacity: podcast.subscribed ? 1 : 0.7,
              }}
              onClick={() =>
                (podcast.subscribed ||
                  podcast.feedUrl?.startsWith('local://')) &&
                navigate(`/podcasts/${podcast.id}`)
              }
            >
              <Group justify="space-between" wrap="nowrap">
                <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Avatar
                    src={podcast.artworkUrl}
                    size={56}
                    radius="sm"
                    color="blue"
                  >
                    <IconMicrophone size={28} />
                  </Avatar>
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} lineClamp={1}>
                      {podcast.title}
                    </Text>
                    {podcast.author && (
                      <Text size="sm" c="dimmed" lineClamp={1}>
                        {podcast.author}
                      </Text>
                    )}
                    <Group gap="xs" mt={4}>
                      {podcast.subscribed ? (
                        <Badge size="sm" variant="light">
                          {podcast.episodeCount} episodes
                        </Badge>
                      ) : podcast.feedUrl?.startsWith('local://') ? (
                        <Badge size="sm" color="violet" variant="outline">
                          Imported
                        </Badge>
                      ) : (
                        <Badge size="sm" color="gray" variant="outline">
                          Unsubscribed
                        </Badge>
                      )}
                      {podcast.lastRefreshedAt && podcast.subscribed && (
                        <Text size="xs" c="dimmed">
                          Updated{' '}
                          {new Date(
                            podcast.lastRefreshedAt,
                          ).toLocaleDateString()}
                        </Text>
                      )}
                    </Group>
                  </div>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  {podcast.subscribed ? (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteOption('keep');
                        setDeleteTarget(podcast);
                      }}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  ) : !podcast.feedUrl?.startsWith('local://') ? (
                    <Button
                      size="xs"
                      variant="light"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleResubscribe(podcast);
                      }}
                    >
                      Re-subscribe
                    </Button>
                  ) : null}
                </Group>
              </Group>
            </Paper>
          ))
        )}
      </Stack>

      <Modal
        opened={addOpen}
        onClose={() => {
          setAddOpen(false);
          setFeedUrl('');
          setAddError('');
        }}
        title="Add Podcast"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label="RSS Feed URL"
            placeholder="https://example.com/podcast.rss"
            required
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.currentTarget.value)}
            leftSection={<IconExternalLink size={14} />}
          />
          {addError && (
            <Alert color="red" icon={<IconAlertTriangle size={14} />}>
              {addError}
            </Alert>
          )}
          <Button
            onClick={() => void handleSubscribe()}
            loading={adding}
            disabled={!feedUrl.trim()}
          >
            Subscribe
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Unsubscribe from podcast"
        size="sm"
      >
        {deleteTarget && (
          <Stack gap="md">
            <Text size="sm">
              Unsubscribing from <strong>{deleteTarget.title}</strong>. What
              should happen to downloaded episodes?
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
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                color="red"
                loading={deleting}
                onClick={() => void handleConfirmDelete()}
              >
                Unsubscribe
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
