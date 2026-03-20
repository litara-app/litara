import {
  Box,
  ScrollArea,
  Text,
  Group,
  Paper,
  TagsInput,
  Button,
  TextInput,
  NumberInput,
  Textarea,
  SimpleGrid,
} from '@mantine/core';
import type { EditedFields } from './BookDetailModal.types';
import { ALL_LOCKABLE_FIELDS } from './BookDetailModal.types';
import { LockButton } from './BookDetailModal.shared';

interface EditMetadataTabProps {
  editedFields: EditedFields;
  lockedFields: Set<string>;
  updateField: <K extends keyof EditedFields>(
    key: K,
    value: EditedFields[K],
  ) => void;
  toggleLock: (field: string) => void;
  setLockedFields: (v: Set<string>) => void;
  setIsDirty: (dirty: boolean) => void;
}

function FieldLabel({
  label,
  fieldName,
  locked,
  onToggle,
}: {
  label: string;
  fieldName: string;
  locked: boolean;
  onToggle: (f: string) => void;
}) {
  return (
    <Group
      gap={4}
      align="center"
      wrap="nowrap"
      style={{ display: 'inline-flex' }}
    >
      <span>{label}</span>
      <LockButton fieldName={fieldName} locked={locked} onToggle={onToggle} />
    </Group>
  );
}

export function EditMetadataTab({
  editedFields,
  lockedFields,
  updateField,
  toggleLock,
  setLockedFields,
  setIsDirty,
}: EditMetadataTabProps) {
  const isLocked = (field: string) => lockedFields.has(field);

  return (
    <ScrollArea style={{ height: '100%' }}>
      <Box p="lg">
        <TextInput
          label={
            <FieldLabel
              label="Title"
              fieldName="title"
              locked={isLocked('title')}
              onToggle={toggleLock}
            />
          }
          value={editedFields.title}
          onChange={(e) => updateField('title', e.currentTarget.value)}
          mb="xs"
        />

        <TextInput
          label={
            <FieldLabel
              label="Subtitle"
              fieldName="subtitle"
              locked={isLocked('subtitle')}
              onToggle={toggleLock}
            />
          }
          value={editedFields.subtitle}
          onChange={(e) => updateField('subtitle', e.currentTarget.value)}
          placeholder="Subtitle..."
          mb="xs"
        />

        <TagsInput
          label={
            <FieldLabel
              label="Authors"
              fieldName="authors"
              locked={isLocked('authors')}
              onToggle={toggleLock}
            />
          }
          value={editedFields.authors}
          onChange={(v) => updateField('authors', v)}
          placeholder="Add authors..."
          mb="md"
        />

        <Textarea
          label={
            <FieldLabel
              label="Description"
              fieldName="description"
              locked={isLocked('description')}
              onToggle={toggleLock}
            />
          }
          value={editedFields.description}
          onChange={(e) => updateField('description', e.currentTarget.value)}
          placeholder="No description..."
          autosize
          minRows={3}
          mb="md"
        />

        <Paper withBorder p="md" radius="md" mb="md">
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Details</Text>
            <Group gap="xs">
              <Button
                size="xs"
                variant="subtle"
                onClick={() => {
                  setLockedFields(new Set(ALL_LOCKABLE_FIELDS));
                  setIsDirty(true);
                }}
              >
                Lock All
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => {
                  setLockedFields(new Set());
                  setIsDirty(true);
                }}
              >
                Unlock All
              </Button>
            </Group>
          </Group>
          <SimpleGrid cols={2} spacing="sm">
            <TextInput
              label={
                <FieldLabel
                  label="ISBN-13"
                  fieldName="isbn13"
                  locked={isLocked('isbn13')}
                  onToggle={toggleLock}
                />
              }
              size="xs"
              value={editedFields.isbn13}
              onChange={(e) => updateField('isbn13', e.currentTarget.value)}
              placeholder="ISBN-13..."
            />
            <TextInput
              label={
                <FieldLabel
                  label="ISBN-10"
                  fieldName="isbn10"
                  locked={isLocked('isbn10')}
                  onToggle={toggleLock}
                />
              }
              size="xs"
              value={editedFields.isbn10}
              onChange={(e) => updateField('isbn10', e.currentTarget.value)}
              placeholder="ISBN-10..."
            />
            <TextInput
              label={
                <FieldLabel
                  label="Publisher"
                  fieldName="publisher"
                  locked={isLocked('publisher')}
                  onToggle={toggleLock}
                />
              }
              size="xs"
              value={editedFields.publisher}
              onChange={(e) => updateField('publisher', e.currentTarget.value)}
              placeholder="Publisher..."
            />
            <TextInput
              label={
                <FieldLabel
                  label="Published Year"
                  fieldName="publishedDate"
                  locked={isLocked('publishedDate')}
                  onToggle={toggleLock}
                />
              }
              size="xs"
              value={editedFields.publishedYear}
              onChange={(e) =>
                updateField('publishedYear', e.currentTarget.value)
              }
              placeholder="YYYY"
              maxLength={4}
            />
            <TextInput
              label={
                <FieldLabel
                  label="Language"
                  fieldName="language"
                  locked={isLocked('language')}
                  onToggle={toggleLock}
                />
              }
              size="xs"
              value={editedFields.language}
              onChange={(e) => updateField('language', e.currentTarget.value)}
              placeholder="e.g. en"
            />
            <NumberInput
              label={
                <FieldLabel
                  label="Pages"
                  fieldName="pageCount"
                  locked={isLocked('pageCount')}
                  onToggle={toggleLock}
                />
              }
              size="xs"
              value={editedFields.pageCount}
              onChange={(v) =>
                updateField('pageCount', v === '' ? '' : Number(v))
              }
              placeholder="Pages..."
              min={0}
            />
            <TextInput
              label={
                <FieldLabel
                  label="Age Rating"
                  fieldName="ageRating"
                  locked={isLocked('ageRating')}
                  onToggle={toggleLock}
                />
              }
              size="xs"
              value={editedFields.ageRating}
              onChange={(e) => updateField('ageRating', e.currentTarget.value)}
              placeholder="e.g. Teen, Adult"
            />
          </SimpleGrid>

          <TagsInput
            label={
              <FieldLabel
                label="Tags"
                fieldName="tags"
                locked={isLocked('tags')}
                onToggle={toggleLock}
              />
            }
            value={editedFields.tags}
            onChange={(v) => updateField('tags', v)}
            placeholder="Add tags..."
            size="xs"
            mt="sm"
          />

          <TagsInput
            label={
              <FieldLabel
                label="Genres"
                fieldName="genres"
                locked={isLocked('genres')}
                onToggle={toggleLock}
              />
            }
            value={editedFields.genres}
            onChange={(v) => updateField('genres', v)}
            placeholder="Add genres..."
            size="xs"
            mt="sm"
          />

          <TagsInput
            label={
              <FieldLabel
                label="Moods"
                fieldName="moods"
                locked={isLocked('moods')}
                onToggle={toggleLock}
              />
            }
            value={editedFields.moods}
            onChange={(v) => updateField('moods', v)}
            placeholder="Add moods..."
            size="xs"
            mt="sm"
          />

          <Box mt="sm">
            <Text size="xs" fw={500} mb={6}>
              Series
            </Text>
            <SimpleGrid cols={3} spacing="xs">
              <TextInput
                label={
                  <FieldLabel
                    label="Name"
                    fieldName="seriesName"
                    locked={isLocked('seriesName')}
                    onToggle={toggleLock}
                  />
                }
                size="xs"
                value={editedFields.seriesName}
                onChange={(e) =>
                  updateField('seriesName', e.currentTarget.value)
                }
                placeholder="Series name..."
              />
              <NumberInput
                label={
                  <FieldLabel
                    label="Book #"
                    fieldName="seriesSequence"
                    locked={isLocked('seriesSequence')}
                    onToggle={toggleLock}
                  />
                }
                size="xs"
                value={editedFields.seriesSequence}
                onChange={(v) =>
                  updateField('seriesSequence', v === '' ? '' : Number(v))
                }
                placeholder="#"
                min={0}
              />
              <NumberInput
                label={
                  <FieldLabel
                    label="Total Books"
                    fieldName="seriesTotalBooks"
                    locked={isLocked('seriesTotalBooks')}
                    onToggle={toggleLock}
                  />
                }
                size="xs"
                value={editedFields.seriesTotalBooks}
                onChange={(v) =>
                  updateField('seriesTotalBooks', v === '' ? '' : Number(v))
                }
                placeholder="Total"
                min={1}
              />
            </SimpleGrid>
          </Box>
        </Paper>

        {/* Spacer so content isn't hidden behind sticky action bar */}
        <Box h={8} />
      </Box>
    </ScrollArea>
  );
}
