import { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  SimpleGrid,
  Text,
  TextInput,
  Center,
  Avatar,
  UnstyledButton,
  Box,
} from '@mantine/core';
import { IconUser, IconSearch } from '@tabler/icons-react';
import { api } from '../utils/api';
import { PageHeader } from '../components/PageHeader';
import { AuthorDetailModal } from '../components/AuthorDetailModal';
import type { AuthorListItem } from '../components/AuthorDetailModal.types';

const CARD_W = 140;
const PHOTO_H = 140;

function AuthorCard({
  author,
  onClick,
}: {
  author: AuthorListItem;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showPhoto = author.hasCover && !imgError;

  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: 8,
        borderRadius: 'var(--mantine-radius-md)',
        width: CARD_W,
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background =
          'var(--mantine-color-gray-1)')
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLElement).style.background = 'transparent')
      }
    >
      {showPhoto ? (
        <img
          src={`/api/v1/authors/${author.id}/photo`}
          alt={author.name}
          onError={() => setImgError(true)}
          style={{
            width: CARD_W - 16,
            height: PHOTO_H,
            objectFit: 'cover',
            borderRadius: 'var(--mantine-radius-md)',
            display: 'block',
          }}
        />
      ) : (
        <Avatar size={PHOTO_H} radius="md" color="gray">
          <IconUser size={48} />
        </Avatar>
      )}
      <Text
        size="sm"
        fw={500}
        ta="center"
        lineClamp={2}
        style={{ width: '100%' }}
      >
        {author.name}
      </Text>
      <Text size="xs" c="dimmed">
        {author.bookCount} {author.bookCount === 1 ? 'book' : 'books'}
      </Text>
    </UnstyledButton>
  );
}

export function AuthorsPage() {
  const [authors, setAuthors] = useState<AuthorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeAuthorId, setActiveAuthorId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AuthorListItem[]>('/authors')
      .then((res) => setAuthors(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return authors;
    const q = search.toLowerCase();
    return authors.filter((a) => a.name.toLowerCase().includes(q));
  }, [authors, search]);

  return (
    <>
      <Stack gap="md" p="md">
        <PageHeader title="Authors" />

        <TextInput
          placeholder="Search authors…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ maxWidth: 340 }}
        />

        {!loading && filtered.length === 0 && (
          <Center h={200}>
            <Text c="dimmed">
              {authors.length === 0
                ? 'No authors found in your library.'
                : 'No authors match your search.'}
            </Text>
          </Center>
        )}

        <Box>
          <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 6, xl: 7 }}>
            {filtered.map((author) => (
              <AuthorCard
                key={author.id}
                author={author}
                onClick={() => setActiveAuthorId(author.id)}
              />
            ))}
          </SimpleGrid>
        </Box>
      </Stack>

      <AuthorDetailModal
        authorId={activeAuthorId}
        onClose={() => setActiveAuthorId(null)}
        onPhotoUpdated={(id, hasCover) =>
          setAuthors((prev) =>
            prev.map((a) => (a.id === id ? { ...a, hasCover } : a)),
          )
        }
      />
    </>
  );
}
