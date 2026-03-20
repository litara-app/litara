import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  ScrollArea,
  Text,
  Group,
  Button,
  Stack,
  Center,
  Code,
} from '@mantine/core';
import { IconRefresh, IconFileExport } from '@tabler/icons-react';
import { pushToast } from '../utils/toast';
import { api } from '../utils/api';
import type { BookDetail, MetadataResult } from './BookDetailModal.types';
import { MetadataComparisonTable } from './MetadataComparisonTable';
import { buildRows, buildApplyPayload } from './metadataApply.shared';

interface SidecarTabProps {
  bookId: string;
  detail: BookDetail;
  lockedFields: Set<string>;
  onApplied: (updated: BookDetail) => void;
  onSwitchTab: (tab: string) => void;
}

export function SidecarTab({
  bookId,
  detail,
  lockedFields,
  onApplied,
  onSwitchTab,
}: SidecarTabProps) {
  const [sidecarFile, setSidecarFile] = useState<string | null>(
    detail.sidecarFile,
  );
  const [contentStatus, setContentStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [sidecarData, setSidecarData] = useState<MetadataResult | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!sidecarFile) return;
    setContentStatus('loading');
    api
      .get<MetadataResult | null>(`/books/${bookId}/sidecar`)
      .then((res) => {
        if (res.data) {
          setSidecarData(res.data);
          setContentStatus('ready');
        } else {
          setContentStatus('error');
        }
      })
      .catch(() => setContentStatus('error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleField(field: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function handleScan() {
    setScanning(true);
    try {
      const res = await api.post<{ sidecarFile: string | null }>(
        `/books/${bookId}/sidecar/scan`,
      );
      const newPath = res.data.sidecarFile;
      setSidecarFile(newPath);
      setSelectedFields(new Set());
      if (newPath) {
        setContentStatus('loading');
        const content = await api.get<MetadataResult | null>(
          `/books/${bookId}/sidecar`,
        );
        if (content.data) {
          setSidecarData(content.data);
          setContentStatus('ready');
        } else {
          setContentStatus('error');
        }
      } else {
        setSidecarData(null);
        setContentStatus('idle');
        pushToast('No sidecar file found', { color: 'yellow' });
      }
    } catch {
      pushToast('Scan failed', { title: 'Error', color: 'red' });
    } finally {
      setScanning(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await api.get(`/books/${bookId}/sidecar/export`, {
        responseType: 'blob',
      });
      const cd: string = (res.headers['content-disposition'] as string) ?? '';
      const rawName =
        cd.match(/filename="([^"]+)"/)?.[1] ?? 'book.metadata.json';
      const name = decodeURIComponent(rawName);
      const url = URL.createObjectURL(res.data as Blob);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: name,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      pushToast('Export failed', { title: 'Error', color: 'red' });
    } finally {
      setExporting(false);
    }
  }

  const rows = useMemo(
    () => (sidecarData ? buildRows(detail, sidecarData, false) : []),
    [detail, sidecarData],
  );

  async function handleApply(onlySelected: boolean) {
    if (!sidecarData) return;
    const payload = buildApplyPayload(
      sidecarData,
      detail,
      lockedFields,
      false,
      onlySelected ? selectedFields : undefined,
    );
    if (Object.keys(payload).length === 0) {
      pushToast('Nothing to apply', { color: 'yellow' });
      return;
    }
    setApplying(true);
    try {
      await api.patch(`/books/${bookId}`, payload);
      const res = await api.get<BookDetail>(`/books/${bookId}`);
      onApplied(res.data);
      onSwitchTab('overview');
      pushToast('Sidecar metadata applied', { color: 'green' });
    } catch {
      pushToast('Failed to apply sidecar', { title: 'Error', color: 'red' });
    } finally {
      setApplying(false);
    }
  }

  const sidecarFilename = sidecarFile?.split(/[\\/]/).pop() ?? null;
  const baseName =
    detail.files[0]?.filePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? detail.title;

  /* ── Not found / error ── */
  if (!sidecarFile || contentStatus === 'error') {
    return (
      <Center style={{ height: '100%' }}>
        <Stack align="center" gap="md">
          <Text c="dimmed">No sidecar file found.</Text>
          <Text size="xs" c="dimmed">
            Expected: <Code>{baseName}.metadata.json</Code>
          </Text>
          <Group>
            <Button
              leftSection={<IconRefresh size={14} />}
              loading={scanning}
              onClick={() => void handleScan()}
            >
              Scan for Sidecar
            </Button>
            <Button
              variant="light"
              leftSection={<IconFileExport size={14} />}
              loading={exporting}
              onClick={() => void handleExport()}
            >
              Export Sidecar
            </Button>
          </Group>
        </Stack>
      </Center>
    );
  }

  /* ── Loading ── */
  if (contentStatus === 'loading') {
    return (
      <Center style={{ height: '100%' }}>
        <Text c="dimmed" size="sm">
          Loading sidecar…
        </Text>
      </Center>
    );
  }

  /* ── Comparison view ── */
  return (
    <ScrollArea style={{ height: '100%' }}>
      <Box p="lg">
        <Group justify="space-between" mb="md" align="center">
          <Text size="sm" c="dimmed">
            Sidecar: <Code>{sidecarFilename}</Code>
          </Text>
        </Group>

        <MetadataComparisonTable
          rows={rows}
          lockedFields={lockedFields}
          selectedFields={selectedFields}
          onToggleField={toggleField}
          sourceLabel="Sidecar"
        />

        <Group justify="space-between" mt="md" align="center">
          <Group gap="sm">
            <Button
              variant="subtle"
              leftSection={<IconRefresh size={14} />}
              loading={scanning}
              onClick={() => void handleScan()}
            >
              Rescan
            </Button>
            <Button
              variant="light"
              leftSection={<IconFileExport size={14} />}
              loading={exporting}
              onClick={() => void handleExport()}
            >
              Export Sidecar
            </Button>
          </Group>
          <Group gap="sm" align="center">
            <Text size="xs" c="dimmed">
              Locked fields will not be overwritten.
            </Text>
            {selectedFields.size > 0 && (
              <Button
                variant="light"
                loading={applying}
                onClick={() => void handleApply(true)}
              >
                Save Selected ({selectedFields.size})
              </Button>
            )}
            <Button loading={applying} onClick={() => void handleApply(false)}>
              Apply All
            </Button>
          </Group>
        </Group>
      </Box>
    </ScrollArea>
  );
}
