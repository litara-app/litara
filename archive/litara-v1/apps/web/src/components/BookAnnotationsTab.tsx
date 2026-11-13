import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconArrowRight, IconSearch, IconTrash } from '@tabler/icons-react';
import { useBookAnnotations } from '../hooks/useBookAnnotations';
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
  HIGHLIGHT: 'Highlight',
  UNDERLINE: 'Underline',
  STRIKETHROUGH: 'Strikethrough',
  BOOKMARK: 'Bookmark',
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

interface BookAnnotationsTabProps {
  bookId: string;
  onClose: () => void;
}

export function BookAnnotationsTab({
  bookId,
  onClose,
}: BookAnnotationsTabProps) {
  const navigate = useNavigate();
  const { annotations, isLoading, deleteAnnotation } =
    useBookAnnotations(bookId);
  const [search, setSearch] = useState('');

  const filtered = annotations.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (a.text ?? '').toLowerCase().includes(q) ||
      (a.note ?? '').toLowerCase().includes(q)
    );
  });

  function handleJump(cfi: string) {
    onClose();
    navigate(`/read/${bookId}`, { state: { cfi } });
  }

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <TextInput
        size="xs"
        placeholder="Search annotations…"
        leftSection={<IconSearch size={12} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />

      <ScrollArea style={{ flex: 1 }}>
        {isLoading ? (
          <Text size="xs" c="dimmed" ta="center" mt="xl">
            Loading…
          </Text>
        ) : filtered.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" mt="xl">
            {search
              ? 'No annotations match your search.'
              : 'No annotations yet. Open the reader and select text to start annotating.'}
          </Text>
        ) : (
          <Stack gap="xs">
            {filtered.map((ann) => (
              <Box
                key={ann.id}
                p="xs"
                style={{
                  borderRadius: 6,
                  border: '1px solid var(--mantine-color-default-border)',
                }}
              >
                <Group justify="space-between" mb={4} wrap="nowrap">
                  <Group gap={6} wrap="nowrap">
                    <Badge
                      size="xs"
                      color={TYPE_COLORS[ann.type]}
                      variant="light"
                    >
                      {TYPE_LABELS[ann.type]}
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
                    <Text size="xs" c="dimmed">
                      {new Date(ann.createdAt).toLocaleDateString()}
                    </Text>
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    {!ann.location.startsWith('audiobook:') && (
                      <Tooltip label="Open in reader" withArrow>
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          size="xs"
                          onClick={() => handleJump(ann.location)}
                        >
                          <IconArrowRight size={11} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    <Tooltip label="Delete" withArrow>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="xs"
                        onClick={() => deleteAnnotation(ann.id)}
                      >
                        <IconTrash size={11} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>

                {ann.location.startsWith('audiobook:') && (
                  <Text size="xs" c="dimmed">
                    {formatAudiobookLocation(ann.location)}
                  </Text>
                )}
                {ann.text && (
                  <Text
                    size="xs"
                    lineClamp={2}
                    style={{ fontStyle: 'italic' }}
                    c="dimmed"
                  >
                    "{ann.text}"
                  </Text>
                )}
                {ann.note && (
                  <Text size="xs" lineClamp={2} mt={2}>
                    {ann.note}
                  </Text>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Stack>
  );
}
