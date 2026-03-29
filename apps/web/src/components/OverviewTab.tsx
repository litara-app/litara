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
} from '@mantine/core';
import type { BookDetail } from './BookDetailModal.types';
import { FileRow, DetailRow } from './BookDetailModal.shared';

interface OverviewTabProps {
  detail: BookDetail;
  onDownload: (fileId: string) => void;
}

export function OverviewTab({ detail, onDownload }: OverviewTabProps) {
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
          <Paper withBorder p="md" radius="md">
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
      </Box>
    </ScrollArea>
  );
}
