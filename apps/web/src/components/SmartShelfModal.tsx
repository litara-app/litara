import { useState } from 'react';
import {
  Modal,
  TextInput,
  SegmentedControl,
  Select,
  Group,
  Stack,
  Button,
  ActionIcon,
  Text,
  Box,
  Divider,
} from '@mantine/core';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { api } from '../utils/api';
import { pushToast } from '../utils/toast';
import type { SmartShelfDetail } from '../types/smartShelf';
import { SMART_SHELF_FIELDS, operatorsForField } from '../types/smartShelf';

interface RuleRow {
  field: string;
  operator: string;
  value: string;
}

interface SmartShelfModalProps {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  shelf?: SmartShelfDetail;
  onDelete?: () => Promise<void>;
}

function emptyRule(): RuleRow {
  return { field: 'title', operator: 'contains', value: '' };
}

export function SmartShelfModal({
  opened,
  onClose,
  onSaved,
  shelf,
  onDelete,
}: SmartShelfModalProps) {
  const isEdit = !!shelf;
  const [name, setName] = useState(shelf?.name ?? '');
  const [logic, setLogic] = useState<'AND' | 'OR'>(shelf?.logic ?? 'AND');
  const [rules, setRules] = useState<RuleRow[]>(
    shelf?.rules.length
      ? shelf.rules.map((r) => ({
          field: r.field,
          operator: r.operator,
          value: r.value,
        }))
      : [emptyRule()],
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function updateRule(index: number, patch: Partial<RuleRow>) {
    setRules((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      // Reset operator if it's no longer valid for the new field
      if (patch.field) {
        const validOps = operatorsForField(patch.field).map((o) => o.value);
        if (!validOps.includes(next[index].operator)) {
          next[index].operator = validOps[0];
        }
      }
      return next;
    });
  }

  function addRule() {
    setRules((prev) => [...prev, emptyRule()]);
  }

  function removeRule(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!name.trim()) {
      pushToast('Please enter a shelf name', { color: 'yellow' });
      return;
    }
    const validRules = rules.filter((r) => r.value.trim());
    if (validRules.length === 0) {
      pushToast('Please add at least one rule with a value', {
        color: 'yellow',
      });
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/smart-shelves/${shelf.id}`, {
          name: name.trim(),
          logic,
          rules: validRules,
        });
      } else {
        await api.post('/smart-shelves', {
          name: name.trim(),
          logic,
          rules: validRules,
        });
      }
      onSaved();
      onClose();
      pushToast(isEdit ? 'Smart shelf updated' : 'Smart shelf created', {
        color: 'green',
      });
    } catch {
      pushToast('Failed to save smart shelf', { title: 'Error', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? 'Edit Smart Shelf' : 'New Smart Shelf'}
      size="lg"
    >
      <Stack gap="md">
        <TextInput
          label="Shelf name"
          placeholder="e.g. Long Fantasy Books"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
        />

        <Box>
          <Text size="sm" fw={500} mb={6}>
            Match
          </Text>
          <SegmentedControl
            value={logic}
            onChange={(v) => setLogic(v as 'AND' | 'OR')}
            data={[
              { value: 'AND', label: 'All rules (AND)' },
              { value: 'OR', label: 'Any rule (OR)' },
            ]}
          />
        </Box>

        <Box>
          <Text size="sm" fw={500} mb={6}>
            Rules
          </Text>
          <Stack gap="xs">
            {rules.map((rule, i) => (
              <Group key={i} gap="xs" align="flex-end" wrap="nowrap">
                {i > 0 && (
                  <Text
                    size="xs"
                    c="dimmed"
                    w={28}
                    ta="center"
                    style={{ flexShrink: 0, paddingBottom: 8 }}
                  >
                    {logic}
                  </Text>
                )}
                {i === 0 && <Box w={28} style={{ flexShrink: 0 }} />}

                <Select
                  value={rule.field}
                  onChange={(v) => updateRule(i, { field: v ?? 'title' })}
                  data={SMART_SHELF_FIELDS}
                  style={{ flex: 2 }}
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  value={rule.operator}
                  onChange={(v) => updateRule(i, { operator: v ?? 'eq' })}
                  data={operatorsForField(rule.field).map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  style={{ flex: 1.5 }}
                  comboboxProps={{ withinPortal: true }}
                />
                <TextInput
                  value={rule.value}
                  onChange={(e) =>
                    updateRule(i, { value: e.currentTarget.value })
                  }
                  placeholder="Value..."
                  style={{ flex: 2 }}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => removeRule(i)}
                  disabled={rules.length === 1}
                  style={{ flexShrink: 0, marginBottom: 1 }}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>

          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={addRule}
            mt="xs"
          >
            Add rule
          </Button>
        </Box>

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void handleSave()}>
            {isEdit ? 'Save changes' : 'Create shelf'}
          </Button>
        </Group>

        {onDelete && (
          <>
            <Divider />
            {confirmDelete ? (
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  Are you sure? This cannot be undone.
                </Text>
                <Group grow>
                  <Button
                    variant="default"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    color="red"
                    loading={deleting}
                    onClick={() => {
                      setDeleting(true);
                      void onDelete().finally(() => {
                        setDeleting(false);
                        onClose();
                      });
                    }}
                  >
                    Confirm Delete
                  </Button>
                </Group>
              </Stack>
            ) : (
              <Button
                color="red"
                variant="light"
                fullWidth
                onClick={() => setConfirmDelete(true)}
              >
                Delete shelf
              </Button>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}
