import { useState } from 'react';
import {
  Stack,
  TextInput,
  Button,
  Text,
  Group,
  Badge,
  MultiSelect,
} from '@mantine/core';
import { IconFolder } from '@tabler/icons-react';
import { FolderBrowserModal } from './FolderBrowserModal';
import { LibraryIconPicker } from './LibraryIconPicker';
import type { Library } from '../store/atoms';

interface LibraryFormValues {
  name: string;
  path: string;
  iconKey: string;
  metadataProvidersDisabled: string[];
}

interface LibraryFormProps {
  initialValues?: Partial<LibraryFormValues>;
  mode?: 'create' | 'edit';
  libraryRoot: string;
  onSubmit: (values: LibraryFormValues) => Promise<void>;
  loading?: boolean;
}

const METADATA_PROVIDERS = [
  { value: 'google-books', label: 'Google Books' },
  { value: 'open-library', label: 'Open Library' },
  { value: 'goodreads', label: 'Goodreads' },
  { value: 'hardcover', label: 'Hardcover' },
  { value: 'audnexus', label: 'Audnexus (Audiobooks)' },
];

export function LibraryForm({
  initialValues,
  mode = 'create',
  libraryRoot,
  onSubmit,
  loading,
}: LibraryFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [path, setPath] = useState(initialValues?.path ?? '');
  const [iconKey, setIconKey] = useState(initialValues?.iconKey ?? '');
  const [disabledProviders, setDisabledProviders] = useState<string[]>(
    initialValues?.metadataProvidersDisabled ?? [],
  );
  const [browserOpen, setBrowserOpen] = useState(false);

  function handleFolderSelect(relPath: string) {
    const fullPath = relPath
      ? `${libraryRoot.replace(/\/+$/, '')}/${relPath}`
      : libraryRoot;
    setPath(fullPath);
  }

  async function handleSubmit() {
    await onSubmit({
      name,
      path,
      iconKey,
      metadataProvidersDisabled: disabledProviders,
    });
  }

  return (
    <Stack gap="md">
      <TextInput
        label="Library Name"
        placeholder="e.g. Ebooks"
        required
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />

      <Stack gap={4}>
        <Text size="sm" fw={500}>
          Folder Path
          {mode === 'edit' && (
            <Text span size="xs" c="dimmed" ml={4}>
              (read-only after creation)
            </Text>
          )}
        </Text>
        {mode === 'create' ? (
          <Group gap="xs" align="flex-end">
            <TextInput
              style={{ flex: 1 }}
              placeholder="Pick a folder or type an absolute path"
              value={path}
              onChange={(e) => setPath(e.currentTarget.value)}
            />
            <Button
              variant="default"
              leftSection={<IconFolder size={16} />}
              onClick={() => setBrowserOpen(true)}
            >
              Browse
            </Button>
          </Group>
        ) : (
          <Badge
            variant="light"
            size="lg"
            style={{
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {path || '(not set)'}
          </Badge>
        )}
        <Text size="xs" c="dimmed">
          Root: {libraryRoot}
        </Text>
      </Stack>

      <LibraryIconPicker
        label="Icon (optional)"
        value={iconKey || null}
        onChange={(key) => setIconKey(key ?? '')}
      />

      <MultiSelect
        label="Disabled Metadata Providers"
        description="These providers will not be used for books in this library. Leave empty to inherit global settings."
        placeholder="Select providers to disable"
        data={METADATA_PROVIDERS}
        value={disabledProviders}
        onChange={setDisabledProviders}
        clearable
      />

      <Button onClick={() => void handleSubmit()} loading={loading} fullWidth>
        {mode === 'create' ? 'Create Library' : 'Save Changes'}
      </Button>

      <FolderBrowserModal
        opened={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onSelect={handleFolderSelect}
        libraryRoot={libraryRoot}
      />
    </Stack>
  );
}

export type { LibraryFormValues };
// Re-export Library type for consumers
export type { Library };
