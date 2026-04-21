import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Paper,
  Box,
  Stack,
  Group,
  Text,
  Avatar,
  Button,
  Loader,
  Center,
  Anchor,
  Divider,
  ScrollArea,
  UnstyledButton,
} from '@mantine/core';
import {
  IconUser,
  IconExternalLink,
  IconBook2,
  IconChevronLeft,
} from '@tabler/icons-react';
import type {
  AuthorBook,
  AuthorDetail,
} from '../components/AuthorDetailModal.types';
import { api } from '../utils/api';
import { pushToast } from '../utils/toast';

const PHOTO_SIZE = 140;
const CARD_W = 130;
const COVER_H = 180;

function BookCard({
  book,
  onClick,
}: {
  book: AuthorBook;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showCover = book.hasCover && !imgError;

  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        width: CARD_W,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '8px 4px',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
    >
      <Box
        style={{ position: 'relative', width: CARD_W - 16, height: COVER_H }}
      >
        {showCover ? (
          <img
            src={`/api/v1/books/${book.id}/cover?v=${book.coverUpdatedAt}`}
            alt=""
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 6,
              display: 'block',
              boxShadow: '0 3px 10px rgba(0,0,0,0.25)',
            }}
          />
        ) : (
          <Box
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--mantine-color-gray-2)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconBook2 size={32} color="var(--mantine-color-dimmed)" />
          </Box>
        )}
      </Box>
      <Text
        size="xs"
        fw={500}
        ta="center"
        lineClamp={2}
        style={{ width: '100%' }}
      >
        {book.title}
      </Text>
    </UnstyledButton>
  );
}

export function AuthorDetailPage() {
  const { authorId } = useParams<{ authorId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from: string =
    (location.state as { from?: string } | null)?.from ?? '/authors';

  const [detail, setDetail] = useState<AuthorDetail | null>(null);
  const [loading, setLoading] = useState(true);

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
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [authorId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      navigate(from);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [navigate, from]);

  function handleEnrichPhoto() {
    if (!authorId) return;
    api
      .post<AuthorDetail>(`/authors/${authorId}/enrich?force=true`)
      .then((res) => {
        setDetail(res.data);
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
          { title: 'Enrichment failed', color: 'red' },
        );
      });
  }

  return (
    <Paper
      withBorder
      radius="md"
      style={{
        height:
          'calc(100dvh - var(--app-shell-header-height) - var(--app-shell-padding) * 2)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── back bar ──────────────────────────────────────────────────────── */}
      <Box
        px="md"
        py="xs"
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Button
          leftSection={<IconChevronLeft size={16} />}
          variant="subtle"
          size="sm"
          onClick={() => navigate(from)}
        >
          Back
        </Button>
      </Box>

      {loading && (
        <Center style={{ flex: 1 }}>
          <Loader />
        </Center>
      )}

      {!loading && detail && (
        <>
          {/* ── scrollable body ───────────────────────────────────────────── */}
          <ScrollArea style={{ flex: 1 }} p="xl">
            <Group align="flex-start" gap="xl">
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
                <Avatar
                  size={PHOTO_SIZE}
                  radius="md"
                  color="gray"
                  style={{ flexShrink: 0 }}
                >
                  <IconUser size={52} />
                </Avatar>
              )}

              <Stack gap="xs" style={{ flex: 1 }}>
                <Text size="xl" fw={700}>
                  {detail.name}
                </Text>
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
                  <Button
                    size="xs"
                    variant="light"
                    onClick={handleEnrichPhoto}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Enrich Author Data
                  </Button>
                )}
              </Stack>
            </Group>
          </ScrollArea>

          {/* ── book strip (fixed at bottom) ──────────────────────────────── */}
          <Divider />
          <Box style={{ flexShrink: 0 }}>
            <ScrollArea
              type="scroll"
              style={{ width: '100%' }}
              offsetScrollbars
            >
              <Box
                px="md"
                py="sm"
                style={{ display: 'flex', gap: 8, minWidth: 'max-content' }}
              >
                {detail.books.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    onClick={() =>
                      navigate(`/books/${book.id}`, {
                        state: { from: location.pathname },
                      })
                    }
                  />
                ))}
              </Box>
            </ScrollArea>
          </Box>
        </>
      )}
    </Paper>
  );
}
