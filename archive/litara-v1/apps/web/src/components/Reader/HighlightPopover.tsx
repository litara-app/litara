import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { IconUnderline, IconStrikethrough } from '@tabler/icons-react';
import type { AnnotationType } from '../../api/annotations';

const HIGHLIGHT_COLORS: { value: string; label: string; hex: string }[] = [
  { value: 'yellow', label: 'Yellow', hex: '#FFE066' },
  { value: 'green', label: 'Green', hex: '#69DB7C' },
  { value: 'blue', label: 'Blue', hex: '#74C0FC' },
  { value: 'pink', label: 'Pink', hex: '#F783AC' },
];

interface HighlightPopoverProps {
  existingAnnotation?: {
    id: string;
    type: AnnotationType;
    color: string | null;
    note: string | null;
  } | null;
  onSave: (data: {
    type: AnnotationType;
    color?: string;
    note?: string;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}

export function HighlightPopover({
  existingAnnotation,
  onSave,
  onDelete,
  onCancel,
}: HighlightPopoverProps) {
  const [selectedType, setSelectedType] = useState<AnnotationType>(
    existingAnnotation?.type ?? 'HIGHLIGHT',
  );
  const [selectedColor, setSelectedColor] = useState<string>(
    existingAnnotation?.color ?? 'yellow',
  );
  const [note, setNote] = useState<string>(existingAnnotation?.note ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        type: selectedType,
        color: selectedType === 'HIGHLIGHT' ? selectedColor : undefined,
        note: note.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setSaving(true);
    try {
      await onDelete();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper shadow="md" p="sm" w={260} withBorder>
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          {existingAnnotation ? 'Edit annotation' : 'Add annotation'}
        </Text>

        {/* Style selector */}
        <Group gap={6}>
          {/* Highlight color chips */}
          {HIGHLIGHT_COLORS.map(({ value, label, hex }) => (
            <Tooltip key={value} label={label} withArrow>
              <div
                onClick={() => {
                  setSelectedType('HIGHLIGHT');
                  setSelectedColor(value);
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  backgroundColor: hex,
                  cursor: 'pointer',
                  border:
                    selectedType === 'HIGHLIGHT' && selectedColor === value
                      ? '2px solid var(--mantine-color-blue-6)'
                      : '2px solid transparent',
                  flexShrink: 0,
                }}
              />
            </Tooltip>
          ))}

          {/* Underline */}
          <Tooltip label="Underline" withArrow>
            <ActionIcon
              variant={selectedType === 'UNDERLINE' ? 'filled' : 'default'}
              size="sm"
              onClick={() => setSelectedType('UNDERLINE')}
            >
              <IconUnderline size={13} />
            </ActionIcon>
          </Tooltip>

          {/* Strikethrough */}
          <Tooltip label="Strikethrough" withArrow>
            <ActionIcon
              variant={selectedType === 'STRIKETHROUGH' ? 'filled' : 'default'}
              size="sm"
              onClick={() => setSelectedType('STRIKETHROUGH')}
            >
              <IconStrikethrough size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {/* Note */}
        <Textarea
          placeholder="Add a note (optional)"
          size="xs"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={5}
        />

        {/* Actions */}
        <Group gap={6} justify="flex-end">
          {existingAnnotation && onDelete && (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              loading={saving}
              onClick={handleDelete}
            >
              Delete
            </Button>
          )}
          <Button
            size="xs"
            variant="default"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button size="xs" loading={saving} onClick={handleSave}>
            Save
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
