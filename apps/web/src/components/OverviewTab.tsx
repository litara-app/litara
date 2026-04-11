import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import {
  Box,
  ScrollArea,
  Title,
  Text,
  Group,
  Badge,
  Paper,
  SimpleGrid,
  Stack,
  Anchor,
  UnstyledButton,
  Center,
} from '@mantine/core';
import { IconArrowRight, IconBook2 } from '@tabler/icons-react';
import { api } from '../utils/api';
import type { BookDetail } from './BookDetailModal.types';
import { FileRow, DetailRow } from './BookDetailModal.shared';

interface OverviewTabProps {
  detail: BookDetail;
  onDownload: (fileId: string) => void;
  onViewSeries?: (seriesId: string) => void;
  onOpenBook?: (bookId: string) => void;
}

// ── Series book item ──────────────────────────────────────────────────────────

interface SeriesBookItem {
  id: string;
  title: string;
  sequence: number | null;
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
}

interface SeriesDetail {
  books: SeriesBookItem[];
}

const CARD_W = 110;
const COVER_H = 155;

function SeriesBookCard({
  book,
  isCurrent,
  onClick,
}: {
  book: SeriesBookItem;
  isCurrent: boolean;
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
        gap: 6,
        padding: '6px 4px',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
    >
      <Box
        style={{
          position: 'relative',
          width: CARD_W - 12,
          height: COVER_H,
          borderRadius: 6,
          outline: isCurrent ? '2px solid var(--mantine-color-blue-5)' : 'none',
          outlineOffset: 2,
        }}
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
          <Center
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--mantine-color-gray-2)',
              borderRadius: 6,
            }}
          >
            <IconBook2 size={28} color="var(--mantine-color-dimmed)" />
          </Center>
        )}

        {/* Sequence badge */}
        {book.sequence != null && (
          <Badge
            size="xs"
            style={{ position: 'absolute', bottom: 6, left: 6, opacity: 0.9 }}
          >
            #{book.sequence}
          </Badge>
        )}

        {/* Current-book indicator */}
        {isCurrent && (
          <Badge
            size="xs"
            color="blue"
            style={{ position: 'absolute', top: 6, right: 6, opacity: 0.95 }}
          >
            This book
          </Badge>
        )}
      </Box>

      <Text
        size="xs"
        fw={isCurrent ? 700 : 500}
        ta="center"
        lineClamp={2}
        style={{ width: '100%' }}
      >
        {book.title}
      </Text>
    </UnstyledButton>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OverviewTab({
  detail,
  onDownload,
  onViewSeries,
  onOpenBook,
}: OverviewTabProps) {
  const [seriesBooks, setSeriesBooks] = useState<SeriesBookItem[]>([]);

  useEffect(() => {
    if (!detail.series?.id) return;
    api
      .get<SeriesDetail>(`/series/${detail.series.id}`)
      .then((res) => setSeriesBooks(res.data.books))
      .catch(() => {});
  }, [detail.series?.id]);

  const showSeriesStrip = seriesBooks.length > 1;

  function renderDescription(desc: string) {
    if (/<[a-z]/i.test(desc)) {
      return (
        <div
          style={{ fontSize: 14 }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(desc) }}
        />
      );
    }
    return (
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
        {desc}
      </Text>
    );
  }

  return (
    <ScrollArea style={{ height: '100%' }}>
      <Box p="lg">
        <Title order={2} mb={4}>
          {detail.title}
        </Title>
        {detail.subtitle && (
          <Text size="sm" c="dimmed" mb={8}>
            {detail.subtitle}
          </Text>
        )}
        <Group gap={6} mb="md" wrap="wrap">
          {detail.authors.length > 0 ? (
            detail.authors.map((a) => (
              <Badge key={a} size="sm" variant="light">
                {a}
              </Badge>
            ))
          ) : (
            <Text size="sm" c="dimmed">
              Unknown author
            </Text>
          )}
        </Group>

        {/* Synopsis */}
        {detail.description && (
          <Box mb="md">
            <Text fw={600} mb="xs">
              Synopsis
            </Text>
            {renderDescription(detail.description)}
          </Box>
        )}

        {/* Details */}
        <Paper withBorder p="md" radius="md" mb="md">
          <Text fw={600} mb="sm">
            Details
          </Text>
          <SimpleGrid cols={2} spacing="sm">
            <DetailRow
              label="Authors"
              value={detail.authors.join(', ') || '—'}
            />
            <DetailRow label="Publisher" value={detail.publisher} />
            <DetailRow
              label="Published"
              value={
                detail.publishedDate
                  ? String(new Date(detail.publishedDate).getFullYear())
                  : null
              }
            />
            <DetailRow label="Language" value={detail.language} />
            <DetailRow label="Pages" value={detail.pageCount} />
            <DetailRow label="ISBN-13" value={detail.isbn13} />
            <DetailRow label="ISBN-10" value={detail.isbn10} />
            <DetailRow label="Age Rating" value={detail.ageRating} />
            <DetailRow
              label="Series"
              value={
                detail.series
                  ? `${detail.series.name}${detail.series.sequence != null ? ` #${detail.series.sequence}` : ''}${detail.series.totalBooks != null ? ` (of ${detail.series.totalBooks})` : ''}`
                  : null
              }
            />
            {detail.series?.id && onViewSeries && (
              <Box style={{ gridColumn: '1 / -1' }}>
                <Anchor
                  component="button"
                  size="xs"
                  onClick={() => onViewSeries(detail.series!.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  View Series <IconArrowRight size={12} />
                </Anchor>
              </Box>
            )}
            <DetailRow label="Goodreads ID" value={detail.goodreadsId} />
            <DetailRow
              label="Goodreads Rating"
              value={
                detail.goodreadsRating != null
                  ? String(detail.goodreadsRating)
                  : null
              }
            />
          </SimpleGrid>
          {detail.tags.length > 0 && (
            <Box mt="sm">
              <Text size="xs" c="dimmed" mb={4}>
                Tags
              </Text>
              <Group gap={4} wrap="wrap">
                {detail.tags.map((t) => (
                  <Badge key={t} size="xs" variant="outline">
                    {t}
                  </Badge>
                ))}
              </Group>
            </Box>
          )}
          {detail.genres.length > 0 && (
            <Box mt="sm">
              <Text size="xs" c="dimmed" mb={4}>
                Genres
              </Text>
              <Group gap={4} wrap="wrap">
                {detail.genres.map((g) => (
                  <Badge key={g} size="xs" variant="outline" color="violet">
                    {g}
                  </Badge>
                ))}
              </Group>
            </Box>
          )}
          {detail.moods.length > 0 && (
            <Box mt="sm">
              <Text size="xs" c="dimmed" mb={4}>
                Moods
              </Text>
              <Group gap={4} wrap="wrap">
                {detail.moods.map((m) => (
                  <Badge key={m} size="xs" variant="outline" color="teal">
                    {m}
                  </Badge>
                ))}
              </Group>
            </Box>
          )}
        </Paper>

        {/* Files */}
        {detail.files.length > 0 && (
          <Paper withBorder p="md" radius="md" mb="md">
            <Text fw={600} mb="sm">
              Files
            </Text>
            <Stack gap={8}>
              {detail.files.map((f) => (
                <FileRow key={f.id} file={f} onDownload={onDownload} />
              ))}
            </Stack>
          </Paper>
        )}

        {/* In This Series */}
        {showSeriesStrip && (
          <Paper withBorder p="md" radius="md">
            <Text fw={600} mb="sm">
              In This Series
            </Text>
            <ScrollArea type="scroll" offsetScrollbars>
              <Box style={{ display: 'flex', gap: 8, paddingBottom: 8 }}>
                {seriesBooks.map((book) => (
                  <SeriesBookCard
                    key={book.id}
                    book={book}
                    isCurrent={book.id === detail.id}
                    onClick={() => {
                      if (book.id !== detail.id) {
                        onOpenBook?.(book.id);
                      }
                    }}
                  />
                ))}
              </Box>
            </ScrollArea>
          </Paper>
        )}
      </Box>
    </ScrollArea>
  );
}
