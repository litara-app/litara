import { useState } from 'react';
import {
  Card,
  AspectRatio,
  Center,
  Badge,
  Box,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconBook2, IconFileX } from '@tabler/icons-react';
import { FORMAT_COLORS } from './BookDetailModal.types';

export interface BookCardData {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt?: string;
  formats: string[];
  hasFileMissing: boolean;
  readingProgress?: number | null;
}

interface BookCardProps extends BookCardData {
  onClick?: () => void;
}

export function BookCard({
  id,
  title,
  authors,
  hasCover,
  coverUpdatedAt,
  formats,
  hasFileMissing,
  readingProgress,
  onClick,
}: BookCardProps) {
  const [imgError, setImgError] = useState(false);
  const showCover = hasCover && !imgError;
  const coverUrl = coverUpdatedAt
    ? `/api/v1/books/${id}/cover?v=${coverUpdatedAt}`
    : `/api/v1/books/${id}/cover`;

  return (
    <Card
      shadow="sm"
      padding="sm"
      radius="md"
      withBorder
      className="book-card"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      <Box mb="sm" style={{ position: 'relative' }}>
        <AspectRatio ratio={2 / 3}>
          {showCover ? (
            <img
              src={coverUrl}
              alt={title}
              style={{
                objectFit: 'cover',
                borderRadius: 4,
                width: '100%',
                height: '100%',
              }}
              onError={() => setImgError(true)}
            />
          ) : (
            <Center
              style={{
                background:
                  'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))',
                borderRadius: 4,
                width: '100%',
                height: '100%',
              }}
            >
              <IconBook2 size={36} color="var(--mantine-color-gray-5)" />
            </Center>
          )}
        </AspectRatio>

        {/* Format badges — top left */}
        <Box
          style={{
            position: 'absolute',
            top: 6,
            left: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {formats.map((fmt) => (
            <Badge
              key={fmt}
              size="xs"
              color={FORMAT_COLORS[fmt] ?? 'gray'}
              radius="sm"
              style={{
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                paddingLeft: 4,
                paddingRight: 6,
              }}
            >
              {fmt}
            </Badge>
          ))}
        </Box>

        {/* Missing file badge — top right */}
        {hasFileMissing && (
          <Box style={{ position: 'absolute', top: 6, right: 0 }}>
            <Tooltip label="File missing from disk">
              <Badge
                size="xs"
                color="red"
                radius="sm"
                leftSection={<IconFileX size={10} />}
                style={{
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                  paddingRight: 4,
                  paddingLeft: 6,
                }}
              >
                Missing
              </Badge>
            </Tooltip>
          </Box>
        )}

        {/* Reading progress overlay — bottom of cover */}
        {readingProgress != null && readingProgress > 0 && (
          <Box
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 4,
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '0 0 4px 4px',
            }}
          >
            <Box
              style={{
                height: '100%',
                width: `${Math.min(100, readingProgress * 100)}%`,
                background: 'var(--mantine-color-green-5)',
                borderRadius: '0 0 0 4px',
              }}
            />
          </Box>
        )}
      </Box>

      <Text fw={500} size="sm" lineClamp={2}>
        {title}
      </Text>
      <Text size="xs" c="dimmed" mt={4}>
        {authors.join(', ') || 'Unknown'}
      </Text>
    </Card>
  );
}
