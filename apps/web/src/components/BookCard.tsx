import { useState, useEffect } from 'react';
import {
  Card,
  AspectRatio,
  Center,
  Badge,
  Box,
  Text,
  Tooltip,
  ActionIcon,
  Group,
  Popover,
  Rating,
  Checkbox,
} from '@mantine/core';
import {
  IconBook2,
  IconFileX,
  IconBook,
  IconStar,
  IconStarFilled,
  IconSend,
  IconHeadphones,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { FORMAT_COLORS } from './BookDetailModal.types';

export interface BookCardData {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  coverUpdatedAt?: string;
  formats: string[];
  hasAudiobook?: boolean;
  hasFileMissing: boolean;
  readingProgress?: number | null;
  audiobookProgressFraction?: number | null;
  seriesName?: string | null;
  readStatus: string | null;
  rating: number | null;
  genres: string[];
  tags: string[];
  moods?: string[];
  publisher?: string | null;
  publishedDate?: string | null;
  createdAt?: string;
  pageCount?: number | null;
  goodreadsRating?: number | null;
}

interface BookCardProps extends BookCardData {
  onClick?: () => void;
  onSend?: () => void;
  onRatingChange?: (rating: number) => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

export function BookCard({
  id,
  title,
  authors,
  hasCover,
  coverUpdatedAt,
  formats,
  hasAudiobook,
  hasFileMissing,
  readingProgress,
  audiobookProgressFraction,
  rating,
  onClick,
  onSend,
  onRatingChange,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: BookCardProps) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [currentRating, setCurrentRating] = useState(rating);

  useEffect(() => {
    setCurrentRating(rating);
  }, [rating]);

  const showCover = hasCover && !imgError;
  const coverUrl = coverUpdatedAt
    ? `/api/v1/books/${id}/cover?v=${coverUpdatedAt}`
    : `/api/v1/books/${id}/cover`;

  function handleRatingChange(val: number) {
    setCurrentRating(val);
    setRatingOpen(false);
    void api.patch(`/books/${id}`, { rating: val });
    onRatingChange?.(val);
  }

  function handleCardClick() {
    if (isSelectMode) {
      onToggleSelect?.();
    } else {
      onClick?.();
    }
  }

  return (
    <Card
      shadow="sm"
      padding="sm"
      radius="md"
      withBorder
      className="book-card"
      onClick={handleCardClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setRatingOpen(false);
      }}
      style={{
        cursor: onClick || isSelectMode ? 'pointer' : undefined,
        outline: isSelected
          ? '2px solid var(--mantine-color-blue-5)'
          : undefined,
        outlineOffset: isSelected ? '-2px' : undefined,
      }}
    >
      <Box mb="sm" style={{ position: 'relative' }}>
        {/* Selection checkbox — top left, visible in select mode */}
        {isSelectMode && (
          <Box
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 2,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.();
            }}
          >
            <Checkbox
              checked={isSelected ?? false}
              onChange={() => {}}
              size="sm"
              styles={{ input: { cursor: 'pointer' } }}
            />
          </Box>
        )}

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
          {hasAudiobook && (
            <Badge
              size="xs"
              color="teal"
              radius="sm"
              leftSection={<IconHeadphones size={9} />}
              style={{
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                paddingLeft: 4,
                paddingRight: 6,
              }}
            >
              Audio
            </Badge>
          )}
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

        {/* Progress overlay — bottom of cover */}
        {(() => {
          const isAudiobookOnly = formats.length === 0 && hasAudiobook;
          const fraction = isAudiobookOnly
            ? (audiobookProgressFraction ?? null)
            : (readingProgress ?? null);
          const color = isAudiobookOnly
            ? 'var(--mantine-color-teal-5)'
            : 'var(--mantine-color-green-5)';
          if (fraction == null || fraction <= 0) return null;
          return (
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
                  width: `${Math.min(100, fraction * 100)}%`,
                  background: color,
                  borderRadius: '0 0 0 4px',
                }}
              />
            </Box>
          );
        })()}

        {/* Quick actions — bottom right, revealed on hover */}
        <Box
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 150ms ease',
            pointerEvents: hovered ? 'auto' : 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Group
            gap={4}
            style={{
              background: 'rgba(0,0,0,0.65)',
              borderRadius: 'var(--mantine-radius-sm)',
              padding: 4,
            }}
          >
            <Tooltip label="Read" withinPortal>
              <ActionIcon
                size="sm"
                variant="transparent"
                c="white"
                onClick={() => navigate(`/read/${id}`)}
              >
                <IconBook size={14} />
              </ActionIcon>
            </Tooltip>

            <Popover
              opened={ratingOpen}
              onChange={setRatingOpen}
              withinPortal
              position="top"
            >
              <Popover.Target>
                <ActionIcon
                  size="sm"
                  variant="transparent"
                  c="white"
                  onClick={() => setRatingOpen((v) => !v)}
                >
                  {currentRating ? (
                    <IconStarFilled
                      size={14}
                      style={{ color: 'var(--mantine-color-yellow-4)' }}
                    />
                  ) : (
                    <IconStar size={14} />
                  )}
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown p="xs">
                <Rating
                  value={currentRating ?? 0}
                  fractions={2}
                  onChange={handleRatingChange}
                />
              </Popover.Dropdown>
            </Popover>

            {onSend && (
              <Tooltip label="Send" withinPortal>
                <ActionIcon
                  size="sm"
                  variant="transparent"
                  c="white"
                  onClick={onSend}
                >
                  <IconSend size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Box>
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
