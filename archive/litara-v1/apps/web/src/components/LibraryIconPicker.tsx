import { SimpleGrid, ActionIcon, Tooltip, Text, Stack } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { LIBRARY_ICONS } from './libraryIcons';

interface LibraryIconPickerProps {
  value: string | null;
  onChange: (key: string | null) => void;
  label?: string;
}

function LibraryIconPicker({ value, onChange, label }: LibraryIconPickerProps) {
  return (
    <Stack gap={4}>
      {label && (
        <Text size="sm" fw={500}>
          {label}
        </Text>
      )}
      <SimpleGrid cols={8} spacing={4}>
        <Tooltip label="No icon" withArrow>
          <ActionIcon
            variant={!value ? 'filled' : 'default'}
            size="lg"
            onClick={() => onChange(null)}
            aria-label="No icon"
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
        {LIBRARY_ICONS.map(({ key, icon: IconComponent, label: iconLabel }) => (
          <Tooltip key={key} label={iconLabel} withArrow>
            <ActionIcon
              variant={value === key ? 'filled' : 'default'}
              size="lg"
              onClick={() => onChange(key)}
              aria-label={iconLabel}
            >
              <IconComponent size={16} />
            </ActionIcon>
          </Tooltip>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export { LibraryIconPicker };
