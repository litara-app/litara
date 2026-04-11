import { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  Avatar,
  ScrollArea,
  UnstyledButton,
  Box,
  Button,
  Loader,
  Center,
  Anchor,
} from '@mantine/core';
import { IconUser, IconExternalLink } from '@tabler/icons-react';
import { api } from '../utils/api';
import { pushToast } from '../utils/toast';
import type { AuthorDetail } from './AuthorDetailModal.types';
import { BookDetailModal } from './BookDetailModal';

interface AuthorDetailModalProps {
  authorId: string | null;
  onClose: () => void;
  onPhotoUpdated?: (authorId: string, hasCover: boolean) => void;
}

const PHOTO_SIZE = 120;

export function AuthorDetailModal({
  authorId,
  onClose,
  onPhotoUpdated,
}: AuthorDetailModalProps) {
  const [detail, setDetail] = useState<AuthorDetail | null>(null);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  // Loading when an authorId is set but the fetched detail doesn't match yet
  const isLoading = !!authorId && detail?.id !== authorId;

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') ?? '{}');
    } catch {
      return {};
    }
  })();
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!authorId) return;
    api
      .get<AuthorDetail>(`/authors/${authorId}`)
      .then((res) => setDetail(res.data))
      .catch(() => {});
  }, [authorId]);

  function handleEnrichPhoto() {
    if (!authorId) return;
    api
      .post<AuthorDetail>(`/authors/${authorId}/enrich?force=true`)
      .then((res) => {
        setDetail(res.data);
        onPhotoUpdated?.(res.data.id, res.data.hasCover);
        if (res.data.hasCover) {
          pushToast('Author photo updated', { color: 'green' });
        } else {
          pushToast('No photo found on Open Library for this author', {
            color: 'yellow',
          });
        }
      })
      .catch(() => {
        pushToast(
          'Failed to enrich author photo — check API logs for the URL',
          {
            title: 'Enrichment failed',
            color: 'red',
          },
        );
      });
  }

  return (
    <>
      <Modal
        opened={!!authorId}
        onClose={onClose}
        title={detail?.name ?? 'Author'}
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {isLoading || !detail ? (
          <Center h={200}>
            <Loader />
          </Center>
        ) : (
          <Stack gap="md">
            <Group align="flex-start" gap="md">
              {detail.hasCover ? (
                <img
                  src={`/api/v1/authors/${detail.id}/photo`}
                  alt={detail.name}
                  style={{
                    width: PHOTO_SIZE,
                    height: PHOTO_SIZE,
                    objectFit: 'cover',
                    borderRadius: 'var(--mantine-radius-md)',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <Avatar size={PHOTO_SIZE} radius="md" color="gray">
                  <IconUser size={48} />
                </Avatar>
              )}

              <Stack gap="xs" style={{ flex: 1 }}>
                <Text size="sm" c={detail.biography ? undefined : 'dimmed'}>
                  {detail.biography ?? 'No biography available.'}
                </Text>
                {detail.goodreadsId && (
                  <Anchor
                    href={`https://www.goodreads.com/author/show/${detail.goodreadsId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                  >
                    <Group gap={4} display="inline-flex">
                      View on Goodreads
                      <IconExternalLink size={13} />
                    </Group>
                  </Anchor>
                )}
                {isAdmin && (
                  <Button size="xs" variant="light" onClick={handleEnrichPhoto}>
                    Enrich Author Data
                  </Button>
                )}
              </Stack>
            </Group>

            <Stack gap={4}>
              <Text fw={600} mb={4}>
                Books ({detail.books.length})
              </Text>
              {detail.books.map((book) => (
                <UnstyledButton
                  key={book.id}
                  onClick={() => setSelectedBookId(book.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 8px',
                    borderRadius: 'var(--mantine-radius-sm)',
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.background =
                      'var(--mantine-color-gray-1)')
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.background =
                      'transparent')
                  }
                >
                  {book.hasCover ? (
                    <img
                      src={`/api/v1/books/${book.id}/cover?v=${book.coverUpdatedAt}`}
                      alt=""
                      style={{
                        width: 32,
                        height: 46,
                        objectFit: 'cover',
                        borderRadius: 2,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <Box
                      style={{
                        width: 32,
                        height: 46,
                        background: 'var(--mantine-color-gray-2)',
                        borderRadius: 2,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Text size="sm">{book.title}</Text>
                </UnstyledButton>
              ))}
            </Stack>
          </Stack>
        )}
      </Modal>

      {selectedBookId && (
        <BookDetailModal
          bookId={selectedBookId}
          onClose={() => setSelectedBookId(null)}
          onBookUpdated={() => {}}
        />
      )}
    </>
  );
}
