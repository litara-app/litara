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
  Tabs,
  ActionIcon,
  Tooltip,
  Button,
} from '@mantine/core';
import {
  IconArrowRight,
  IconBook2,
  IconHeadphones,
  IconDownload,
} from '@tabler/icons-react';
import { useSetAtom, useAtomValue } from 'jotai';
import { api } from '../utils/api';
import type { BookDetail } from './BookDetailModal.types';
import { FileRow, DetailRow } from './BookDetailModal.shared';
import { formatBytesNum } from './BookDetailModal.utils';
import { audiobookPlayerAtom } from '../store/atoms';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

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
  const setPlayer = useSetAtom(audiobookPlayerAtom);
  const currentPlayer = useAtomValue(audiobookPlayerAtom);
  const isPlayingThisBook = currentPlayer?.bookId === detail.id;

  useEffect(() => {
    if (!detail.series?.id) return;
    api
      .get<SeriesDetail>(`/series/${detail.series.id}`)
      .then((res) => setSeriesBooks(res.data.books))
      .catch(() => {});
  }, [detail.series?.id]);

  const showSeriesStrip = seriesBooks.length > 1;

  function handlePlayAudiobook() {
    setPlayer({
      bookId: detail.id,
      bookTitle: detail.title,
      hasCover: detail.hasCover,
      narrator: detail.audiobookFiles[0]?.narrator ?? null,
      audiobookFiles: detail.audiobookFiles.map((f) => ({
        id: f.id,
        fileIndex: f.fileIndex,
        duration: f.duration,
        mimeType: f.mimeType,
        narrator: f.narrator,
        chapters: f.chapters,
      })),
      initialProgress: detail.audiobookProgress,
    });
  }

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

        {/* Audiobook section */}
        {detail.hasAudiobook && detail.audiobookFiles.length > 0 && (
          <Paper withBorder p="md" radius="md" mb="md">
            <Group justify="space-between" align="flex-start">
              <Box>
                <Text fw={600}>Audiobook</Text>
                {detail.audiobookFiles[0]?.narrator && (
                  <Text size="sm" c="dimmed">
                    Narrated by {detail.audiobookFiles[0].narrator}
                  </Text>
                )}
                <Text size="xs" c="dimmed" mt={2}>
                  {formatDuration(
                    detail.audiobookFiles.reduce((s, f) => s + f.duration, 0),
                  )}
                </Text>
                {detail.audiobookProgress &&
                  (() => {
                    const prog = detail.audiobookProgress;
                    const preceding = detail.audiobookFiles
                      .filter((f) => f.fileIndex < prog.currentFileIndex)
                      .reduce((s, f) => s + f.duration, 0);
                    const elapsed = preceding + prog.currentTime;
                    const total = detail.audiobookFiles.reduce(
                      (s, f) => s + f.duration,
                      0,
                    );
                    return (
                      <Text size="xs" c="teal" mt={2}>
                        {formatDuration(elapsed)} / {formatDuration(total)}
                      </Text>
                    );
                  })()}
              </Box>
              {isPlayingThisBook ? (
                <Stack gap={4} align="flex-end">
                  <Badge color="green" variant="light">
                    Now Playing
                  </Badge>
                  <Text size="xs" c="dimmed">
                    Active in the bottom player bar
                  </Text>
                </Stack>
              ) : (
                <Button
                  leftSection={<IconHeadphones size={16} />}
                  onClick={handlePlayAudiobook}
                  variant="filled"
                  size="sm"
                >
                  Play Audiobook
                </Button>
              )}
            </Group>
          </Paper>
        )}

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
        {(detail.files.length > 0 || detail.audiobookFiles.length > 0) && (
          <Paper withBorder p="md" radius="md" mb="md">
            <Tabs defaultValue="ebook">
              <Tabs.List mb="sm">
                <Tabs.Tab value="ebook">Ebook Files</Tabs.Tab>
                {detail.audiobookFiles.length > 0 && (
                  <Tabs.Tab value="audiobook">Audiobook Files</Tabs.Tab>
                )}
              </Tabs.List>

              <Tabs.Panel value="ebook">
                {detail.files.length > 0 ? (
                  <Stack gap={8}>
                    {detail.files.map((f) => (
                      <FileRow key={f.id} file={f} onDownload={onDownload} />
                    ))}
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    No ebook files
                  </Text>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="audiobook">
                {detail.audiobookFiles.length > 1 && (
                  <Group justify="flex-end" mb="sm">
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconDownload size={12} />}
                      onClick={async () => {
                        const res = await api.get(
                          `/audiobooks/${detail.id}/files/download-all`,
                          { responseType: 'blob' },
                        );
                        const url = URL.createObjectURL(res.data as Blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = '';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Download All
                    </Button>
                  </Group>
                )}
                <Stack gap={8}>
                  {detail.audiobookFiles.map((af) => {
                    const ext =
                      af.filePath.split('.').pop()?.toUpperCase() ?? '';
                    return (
                      <Group key={af.id} gap={10} align="center" wrap="nowrap">
                        {/* Left: icon + format + duration */}
                        <Stack
                          gap={2}
                          align="center"
                          style={{ flexShrink: 0, width: 52 }}
                        >
                          <IconHeadphones
                            size={14}
                            color="var(--mantine-color-teal-6)"
                          />
                          <Badge
                            size="xs"
                            color="teal"
                            variant="light"
                            radius="sm"
                          >
                            {ext}
                          </Badge>
                          {af.duration > 0 && (
                            <Text size="xs" c="dimmed" ta="center">
                              {formatDuration(af.duration)}
                            </Text>
                          )}
                        </Stack>
                        {/* Middle: full path */}
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            size="xs"
                            style={{
                              wordBreak: 'break-all',
                              fontFamily: 'monospace',
                            }}
                          >
                            {af.filePath}
                          </Text>
                          {af.narrator && (
                            <Text size="xs" c="dimmed" mt={2}>
                              Narrated by {af.narrator}
                            </Text>
                          )}
                        </Box>
                        {/* Size */}
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{
                            flexShrink: 0,
                            textAlign: 'right',
                            minWidth: 56,
                          }}
                        >
                          {formatBytesNum(af.fileSize)}
                        </Text>
                        {/* Download */}
                        <Tooltip label="Download" withinPortal>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="teal"
                            style={{ flexShrink: 0 }}
                            onClick={async () => {
                              const res = await api.get(
                                `/audiobooks/${detail.id}/files/${af.fileIndex}/download`,
                                { responseType: 'blob' },
                              );
                              const url = URL.createObjectURL(res.data as Blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download =
                                af.filePath.split(/[\\/]/).pop() ?? '';
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          >
                            <IconDownload size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    );
                  })}
                </Stack>
              </Tabs.Panel>
            </Tabs>
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
