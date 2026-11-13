import { useState, useEffect } from 'react';
import {
  Modal,
  SimpleGrid,
  Loader,
  Text,
  Center,
  Badge,
  Box,
  AspectRatio,
  Overlay,
  Stack,
} from '@mantine/core';
import { api } from '../utils/api';
import type { BookDetail, MetadataResult } from './BookDetailPage.types';
import { pushToast } from '../utils/toast';

interface CoverResult {
  coverUrl: string;
  provider: string;
  providerLabel: string;
}

interface ReplaceCoverModalProps {
  opened: boolean;
  onClose: () => void;
  detail: BookDetail;
  onApply: (payload: Record<string, unknown>) => Promise<void>;
}

export function ReplaceCoverModal({
  opened,
  onClose,
  detail,
  onApply,
}: ReplaceCoverModalProps) {
  const [covers, setCovers] = useState<CoverResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const firstAuthor = detail.authors[0];

  useEffect(() => {
    if (!opened) return;
    setCovers([]);
    setLoading(true);

    const params = new URLSearchParams();
    if (detail.isbn13) params.set('isbn', detail.isbn13);
    else if (detail.isbn10) params.set('isbn', detail.isbn10);
    params.set('title', detail.title);
    if (firstAuthor) params.set('author', firstAuthor);

    api
      .get<Array<{ id: string; label: string }>>('/settings/metadata-providers')
      .then(({ data: providers }) => {
        const calls = providers.map((p) =>
          api
            .get<MetadataResult[]>(
              `/books/${detail.id}/search-metadata?provider=${p.id}&${params.toString()}`,
            )
            .then((r) => ({
              provider: p.id,
              label: p.label,
              results: r.data ?? [],
            }))
            .catch(() => ({
              provider: p.id,
              label: p.label,
              results: [] as MetadataResult[],
            })),
        );
        return Promise.all(calls);
      })
      .then((allResults) => {
        const found: CoverResult[] = [];
        const seen = new Set<string>();
        for (const { provider, label, results } of allResults) {
          for (const r of results) {
            if (r.coverUrl && !seen.has(r.coverUrl)) {
              seen.add(r.coverUrl);
              found.push({
                coverUrl: r.coverUrl,
                provider,
                providerLabel: label,
              });
            }
          }
        }
        setCovers(found);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [
    opened,
    detail.id,
    detail.isbn13,
    detail.isbn10,
    detail.title,
    firstAuthor,
  ]);

  async function handleSelect(coverUrl: string) {
    setApplying(coverUrl);
    try {
      await onApply({ coverUrl });
      pushToast('Cover updated', { color: 'green' });
      onClose();
    } catch {
      pushToast('Failed to update cover', { title: 'Error', color: 'red' });
    } finally {
      setApplying(null);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Replace Cover" size="xl">
      {loading && (
        <Center py="xl">
          <Stack align="center" gap="sm">
            <Loader />
            <Text size="sm" c="dimmed">
              Searching providers for covers…
            </Text>
          </Stack>
        </Center>
      )}
      {!loading && covers.length === 0 && (
        <Center py="xl">
          <Text c="dimmed">No covers found from any provider</Text>
        </Center>
      )}
      {!loading && covers.length > 0 && (
        <SimpleGrid cols={4} spacing="sm">
          {covers.map((c) => (
            <Box
              key={c.coverUrl}
              style={{ position: 'relative', cursor: 'pointer' }}
              onClick={() => void handleSelect(c.coverUrl)}
            >
              <AspectRatio ratio={2 / 3}>
                <img
                  src={c.coverUrl}
                  alt=""
                  style={{
                    objectFit: 'cover',
                    borderRadius: 6,
                    width: '100%',
                    height: '100%',
                  }}
                />
              </AspectRatio>
              <Badge
                size="xs"
                style={{ position: 'absolute', top: 4, left: 4 }}
              >
                {c.providerLabel}
              </Badge>
              {applying === c.coverUrl && (
                <Overlay color="#000" backgroundOpacity={0.6} radius={6} center>
                  <Loader color="white" size="sm" />
                </Overlay>
              )}
            </Box>
          ))}
        </SimpleGrid>
      )}
    </Modal>
  );
}
