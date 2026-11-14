import { useState, useCallback, useEffect } from 'react';
import {
  Title,
  Stack,
  Text,
  Paper,
  Group,
  Badge,
  ThemeIcon,
  Divider,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import {
  IconUpload,
  IconX,
  IconBook,
  IconAlertCircle,
  IconCircleCheck,
  IconInfoCircle,
  IconLock,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import type { AxiosError } from 'axios';

const SUPPORTED_MIME = [
  'application/epub+zip',
  'application/x-mobipocket-ebook',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
];

const SUPPORTED_EXT = ['epub', 'mobi', 'azw', 'azw3', 'cbz', 'pdf'];

interface UploadResult {
  filename: string;
  status: 'success' | 'duplicate' | 'error';
  title?: string | null;
  authors?: string;
  message?: string;
}

export function BookDropPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api
      .get<{ configured: boolean }>('/book-drop/status')
      .then((r) => setConfigured(r.data.configured))
      .catch(() => setConfigured(false));
  }, []);

  const handleDrop = useCallback(async (files: File[]) => {
    setUploading(true);

    const newResults = await Promise.all(
      files.map(async (file): Promise<UploadResult> => {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!SUPPORTED_EXT.includes(ext)) {
          return {
            filename: file.name,
            status: 'error',
            message: 'Unsupported file type',
          };
        }

        const form = new FormData();
        form.append('files', file);

        try {
          const res = await api.post<
            { title?: string | null; authors?: string }[]
          >('/book-drop/upload', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const book = res.data[0];
          const authors = book?.authors
            ? (JSON.parse(book.authors) as string[]).join(', ')
            : '';
          return {
            filename: file.name,
            status: 'success',
            title: book?.title,
            authors,
          };
        } catch (err) {
          const status = (err as AxiosError).response?.status;
          const message =
            status === 409
              ? 'Already in the pending queue'
              : status === 503
                ? 'Book drop folder is not configured on the server'
                : 'Upload failed. Please try again.';
          return {
            filename: file.name,
            status: status === 409 ? 'duplicate' : 'error',
            message,
          };
        }
      }),
    );

    setResults((prev) => [...newResults, ...prev]);
    setUploading(false);
  }, []);

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Book Drop</Title>
        <Text c="dimmed" mt={4}>
          Drop ebook files here to send them to the admin review queue.
          Supported formats: EPUB, MOBI, AZW, AZW3, CBZ, PDF.
        </Text>
      </div>

      <Paper withBorder radius="md" p="xl">
        <Stack gap="md">
          <Text
            fw={500}
            size="sm"
            c="dimmed"
            tt="uppercase"
            style={{ letterSpacing: '0.05em' }}
          >
            Upload files
          </Text>

          {configured === false ? (
            <Paper
              withBorder
              radius="md"
              p="xl"
              style={{
                border: '2px dashed var(--mantine-color-red-6)',
                background: 'var(--mantine-color-red-light)',
              }}
            >
              <Stack align="center" gap="md" py="xl">
                <ThemeIcon size={80} radius="xl" color="red" variant="light">
                  <IconLock size={40} stroke={1.5} />
                </ThemeIcon>
                <Stack gap={4} align="center">
                  <Text size="lg" fw={600} c="red">
                    Uploads disabled
                  </Text>
                  <Text size="sm" c="dimmed" ta="center">
                    The server does not have a book drop folder configured. Ask
                    your admin to set <code>BOOK_DROP_PATH</code> in the server
                    environment and restart.
                  </Text>
                </Stack>
              </Stack>
            </Paper>
          ) : (
            <Dropzone
              onDrop={(files) => void handleDrop(files)}
              onReject={(files) => {
                const rejected = files.map((f) => ({
                  filename: f.file.name,
                  status: 'error' as const,
                  message: 'Unsupported file type',
                }));
                setResults((prev) => [...rejected, ...prev]);
              }}
              accept={SUPPORTED_MIME}
              loading={uploading}
              maxFiles={20}
              style={{
                border: '2px dashed var(--mantine-color-default-border)',
              }}
            >
              <Stack
                align="center"
                gap="md"
                py="xl"
                style={{ pointerEvents: 'none' }}
              >
                <Dropzone.Accept>
                  <ThemeIcon size={80} radius="xl" color="blue" variant="light">
                    <IconUpload size={40} stroke={1.5} />
                  </ThemeIcon>
                </Dropzone.Accept>
                <Dropzone.Reject>
                  <ThemeIcon size={80} radius="xl" color="red" variant="light">
                    <IconX size={40} stroke={1.5} />
                  </ThemeIcon>
                </Dropzone.Reject>
                <Dropzone.Idle>
                  <ThemeIcon size={80} radius="xl" color="blue" variant="light">
                    <IconBook size={40} stroke={1.5} />
                  </ThemeIcon>
                </Dropzone.Idle>

                <Stack gap={4} align="center">
                  <Text size="lg" fw={600}>
                    Drag ebook files here or click to browse
                  </Text>
                  <Text size="sm" c="dimmed">
                    EPUB · MOBI · AZW · AZW3 · CBZ · PDF — up to 20 files at
                    once
                  </Text>
                </Stack>
              </Stack>
            </Dropzone>
          )}
        </Stack>
      </Paper>

      {results.length > 0 && (
        <Paper withBorder radius="md" p="xl">
          <Stack gap="md">
            <Text
              fw={500}
              size="sm"
              c="dimmed"
              tt="uppercase"
              style={{ letterSpacing: '0.05em' }}
            >
              Upload results
            </Text>
            <Divider />
            <Stack gap="sm">
              {results.map((r, i) => (
                <Paper
                  key={i}
                  withBorder
                  p="md"
                  radius="md"
                  bg={
                    r.status === 'success'
                      ? 'var(--mantine-color-teal-light)'
                      : r.status === 'duplicate'
                        ? 'var(--mantine-color-yellow-light)'
                        : 'var(--mantine-color-red-light)'
                  }
                >
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <ThemeIcon
                      size="md"
                      radius="xl"
                      color={
                        r.status === 'success'
                          ? 'teal'
                          : r.status === 'duplicate'
                            ? 'yellow'
                            : 'red'
                      }
                      variant="light"
                      style={{ flexShrink: 0, marginTop: 2 }}
                    >
                      {r.status === 'success' ? (
                        <IconCircleCheck size={16} />
                      ) : r.status === 'duplicate' ? (
                        <IconInfoCircle size={16} />
                      ) : (
                        <IconAlertCircle size={16} />
                      )}
                    </ThemeIcon>

                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Group gap="sm" wrap="nowrap">
                        <Text size="sm" fw={500} style={{ flex: 1 }} truncate>
                          {r.title ?? r.filename}
                        </Text>
                        {r.status === 'success' && (
                          <Badge
                            color="teal"
                            size="sm"
                            style={{ flexShrink: 0 }}
                          >
                            Pending Review
                          </Badge>
                        )}
                        {r.status === 'duplicate' && (
                          <Badge
                            color="yellow"
                            size="sm"
                            style={{ flexShrink: 0 }}
                          >
                            Duplicate
                          </Badge>
                        )}
                      </Group>
                      {r.authors && (
                        <Text size="xs" c="dimmed">
                          {r.authors}
                        </Text>
                      )}
                      {r.message && r.status !== 'success' && (
                        <Text size="xs" c="dimmed">
                          {r.message}
                        </Text>
                      )}
                      {r.title && (
                        <Text size="xs" c="dimmed">
                          {r.filename}
                        </Text>
                      )}
                    </Stack>
                  </Group>
                </Paper>
              ))}
            </Stack>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
