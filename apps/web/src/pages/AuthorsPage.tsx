import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Stack,
  SimpleGrid,
  Text,
  Center,
  Avatar,
  UnstyledButton,
  Box,
} from '@mantine/core';
import { IconUser } from '@tabler/icons-react';
import { api } from '../utils/api';
import { PageHeader } from '../components/PageHeader';
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
  const navigate = useNavigate();
  const location = useLocation();
  const [authors, setAuthors] = useState<AuthorListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AuthorListItem[]>('/authors')
      .then((res) => setAuthors(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Stack gap="md" p="md">
        <PageHeader title="Authors" />

        {!loading && authors.length === 0 && (
          <Center h={200}>
            <Text c="dimmed">No authors found in your library.</Text>
          </Center>
        )}

        <Box>
          <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 6, xl: 7 }}>
            {authors.map((author) => (
              <AuthorCard
                key={author.id}
                author={author}
                onClick={() =>
                  navigate(`/authors/${author.id}`, {
                    state: { from: location.pathname },
                  })
                }
              />
            ))}
          </SimpleGrid>
        </Box>
      </Stack>
    </>
  );
}
