import { useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  Switch,
  ActionIcon,
  Button,
  MultiSelect,
} from '@mantine/core';
import { IconChevronUp, IconChevronDown } from '@tabler/icons-react';
import { useAtomValue } from 'jotai';
import { librariesAtom } from '../store/atoms';
import type { DashboardSection } from '../store/atoms';

interface DashboardSettingsModalProps {
  opened: boolean;
  onClose: () => void;
  layout: DashboardSection[];
  onSave: (layout: DashboardSection[]) => void;
}

function ModalContent({
  layout,
  onSave,
}: {
  layout: DashboardSection[];
  onSave: (layout: DashboardSection[]) => void;
}) {
  const [localLayout, setLocalLayout] = useState<DashboardSection[]>(() =>
    [...layout].sort((a, b) => a.order - b.order),
  );
  const libraries = useAtomValue(librariesAtom);

  function toggleVisible(key: string) {
    setLocalLayout((prev) =>
      prev.map((s) => (s.key === key ? { ...s, visible: !s.visible } : s)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...localLayout];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setLocalLayout(next.map((s, i) => ({ ...s, order: i })));
  }

  function setLibraryIds(key: string, ids: string[]) {
    setLocalLayout((prev) =>
      prev.map((s) => (s.key === key ? { ...s, libraryIds: ids } : s)),
    );
  }

  return (
    <Stack gap="sm">
      {localLayout.map((section, i) => (
        <Stack key={section.key} gap={4}>
          <Group justify="space-between">
            <Text size="sm">{section.label}</Text>
            <Group gap="xs">
              <Switch
                checked={section.visible}
                onChange={() => toggleVisible(section.key)}
                size="sm"
              />
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => move(i, -1)}
                disabled={i === 0}
              >
                <IconChevronUp size={14} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => move(i, 1)}
                disabled={i === localLayout.length - 1}
              >
                <IconChevronDown size={14} />
              </ActionIcon>
            </Group>
          </Group>
          {section.key === 'recently-added' && libraries.length > 0 && (
            <MultiSelect
              placeholder="All libraries"
              data={libraries.map((l) => ({ value: l.id, label: l.name }))}
              value={section.libraryIds ?? []}
              onChange={(ids) => setLibraryIds(section.key, ids)}
              clearable
              size="xs"
            />
          )}
        </Stack>
      ))}
      <Button mt="sm" onClick={() => onSave(localLayout)}>
        Save
      </Button>
    </Stack>
  );
}

export function DashboardSettingsModal({
  opened,
  onClose,
  layout,
  onSave,
}: DashboardSettingsModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Dashboard Settings"
      size="sm"
    >
      {opened && <ModalContent layout={layout} onSave={onSave} />}
    </Modal>
  );
}
