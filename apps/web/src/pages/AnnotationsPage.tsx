import { useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Chip,
  Group,
  Image,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowRight,
  IconBookmarks,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { useAllAnnotations } from '../hooks/useAllAnnotations';
import type { AnnotationType } from '../api/annotations';

function formatAudiobookLocation(location: string): string {
  const secs = parseFloat(location.replace('audiobook:', ''));
  if (!isFinite(secs)) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TYPE_LABELS: Record<AnnotationType, string> = {
  HIGHLIGHT: 'Highlights',
  UNDERLINE: 'Underlines',
  STRIKETHROUGH: 'Strikethroughs',
  BOOKMARK: 'Bookmarks',
};

const TYPE_COLORS: Record<AnnotationType, string> = {
  HIGHLIGHT: 'yellow',
  UNDERLINE: 'blue',
  STRIKETHROUGH: 'red',
  BOOKMARK: 'orange',
};

const COLOR_SWATCHES: Record<string, string> = {
  yellow: '#FFE066',
  green: '#69DB7C',
  blue: '#74C0FC',
  pink: '#F783AC',
};

const ALL_TYPES: AnnotationType[] = [
  'HIGHLIGHT',
  'UNDERLINE',
  'STRIKETHROUGH',
  'BOOKMARK',
];

export function AnnotationsPage() {
  const navigate = useNavigate();
  const {
    annotations,
    isLoading,
    typeFilter,
    setTypeFilter,
    search,
    setSearch,
    deleteAnnotation,
  } = useAllAnnotations();

  function handleJump(bookId: string, cfi: string) {
    navigate(`/read/${bookId}`, { state: { cfi } });
  }

  return (
    <Stack gap={0} style={{ height: '100%' }}>
      <Box px="lg" pt="lg">
        <Title order={2}>Annotations</Title>
      </Box>

      <Box px="lg" py="sm">
        <Group gap="sm" wrap="wrap">
          <TextInput
            size="sm"
            placeholder="Search annotations…"
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Chip.Group
            value={typeFilter ?? 'all'}
            onChange={(v) =>
              setTypeFilter(v === 'all' ? undefined : (v as AnnotationType))
            }
          >
            <Group gap={6}>
              <Chip value="all" size="xs" variant="light">
                All
              </Chip>
              {ALL_TYPES.map((t) => (
                <Chip
                  key={t}
                  value={t}
                  size="xs"
                  variant="light"
                  color={TYPE_COLORS[t]}
                >
                  {TYPE_LABELS[t]}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} px="lg">
        {isLoading ? (
          <Center mt="xl">
            <Loader size="sm" />
          </Center>
        ) : annotations.length === 0 ? (
          <Center mt="xl">
            <Stack align="center" gap="xs">
              <IconBookmarks size={40} style={{ opacity: 0.3 }} />
              <Text c="dimmed" size="sm">
                {search || typeFilter
                  ? 'No annotations match your filter.'
                  : 'No annotations yet. Open a book in the reader and select text to start highlighting.'}
              </Text>
            </Stack>
          </Center>
        ) : (
          <Stack gap="xs" pb="xl">
            {annotations.map((ann) => (
              <Box
                key={ann.id}
                p="sm"
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--mantine-color-default-border)',
                }}
              >
                <Group gap="sm" align="flex-start" wrap="nowrap">
                  {/* Book cover */}
                  <Box style={{ flexShrink: 0, width: 40 }}>
                    {ann.book.coverData ? (
                      <Image
                        src={`/api/v1/books/${ann.book.id}/cover`}
                        w={40}
                        h={56}
                        fit="cover"
                        radius="sm"
                        alt={ann.book.title}
                      />
                    ) : (
                      <Box
                        w={40}
                        h={56}
                        style={{
                          borderRadius: 4,
                          background: 'var(--mantine-color-default-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <IconBookmarks size={14} style={{ opacity: 0.4 }} />
                      </Box>
                    )}
                  </Box>

                  {/* Content */}
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text
                        size="xs"
                        fw={600}
                        lineClamp={1}
                        style={{ flex: 1 }}
                      >
                        {ann.book.title}
                      </Text>
                      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                        {new Date(ann.createdAt).toLocaleDateString()}
                      </Text>
                    </Group>

                    <Group gap={6}>
                      <Badge
                        size="xs"
                        color={TYPE_COLORS[ann.type]}
                        variant="light"
                      >
                        {TYPE_LABELS[ann.type].slice(0, -1)}
                      </Badge>
                      {ann.color && COLOR_SWATCHES[ann.color] && (
                        <div
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 2,
                            backgroundColor: COLOR_SWATCHES[ann.color],
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </Group>

                    {ann.location.startsWith('audiobook:') && (
                      <Text size="xs" c="dimmed">
                        {formatAudiobookLocation(ann.location)}
                      </Text>
                    )}
                    {ann.text && (
                      <Text
                        size="xs"
                        c="dimmed"
                        lineClamp={2}
                        style={{ fontStyle: 'italic' }}
                      >
                        "{ann.text}"
                      </Text>
                    )}
                    {ann.note && (
                      <Text size="xs" lineClamp={2}>
                        {ann.note}
                      </Text>
                    )}
                  </Stack>

                  {/* Actions */}
                  <Group gap={4} style={{ flexShrink: 0 }}>
                    {!ann.location.startsWith('audiobook:') && (
                      <Tooltip label="Open in reader" withArrow>
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          size="sm"
                          onClick={() => handleJump(ann.book.id, ann.location)}
                        >
                          <IconArrowRight size={14} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    <Tooltip label="Delete" withArrow>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        onClick={() => deleteAnnotation(ann.book.id, ann.id)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              </Box>
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Stack>
  );
}
