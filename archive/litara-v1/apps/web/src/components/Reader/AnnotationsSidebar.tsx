import {
  ActionIcon,
  Badge,
  Box,
  Group,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconTrash, IconX } from '@tabler/icons-react';
import type { Annotation, AnnotationType } from '../../api/annotations';

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

interface AnnotationsSidebarProps {
  annotations: Annotation[];
  onJump: (cfi: string) => void;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function AnnotationsSidebar({
  annotations,
  onJump,
  onDelete,
  onClose,
}: AnnotationsSidebarProps) {
  return (
    <Box
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 300,
        background: 'var(--mantine-color-body)',
        borderLeft: '1px solid var(--mantine-color-default-border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      <Group
        px="sm"
        py="xs"
        style={{
          borderBottom: '1px solid var(--mantine-color-default-border)',
          flexShrink: 0,
        }}
      >
        <Text fw={600} size="sm" style={{ flex: 1 }}>
          Annotations ({annotations.length})
        </Text>
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose}>
          <IconX size={14} />
        </ActionIcon>
      </Group>

      <ScrollArea style={{ flex: 1 }} p="xs">
        {annotations.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" mt="xl">
            No annotations yet. Select text in the reader to highlight or add a
            note.
          </Text>
        ) : (
          <Stack gap="xs">
            {annotations.map((ann) => (
              <Box
                key={ann.id}
                p="xs"
                style={{
                  borderRadius: 6,
                  border: '1px solid var(--mantine-color-default-border)',
                  cursor: 'pointer',
                }}
                onClick={() => onJump(ann.location)}
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
                  </Group>
                  <Tooltip label="Delete" withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(ann.id);
                      }}
                    >
                      <IconTrash size={11} />
                    </ActionIcon>
                  </Tooltip>
                </Group>

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
    </Box>
  );
}
