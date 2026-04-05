import { useState, useEffect, useRef } from 'react';
import {
  Title,
  Stack,
  Paper,
  Text,
  Button,
  Switch,
  Select,
  NumberInput,
  Group,
  Skeleton,
  Alert,
  Modal,
  Badge,
  Box,
  Card,
  SimpleGrid,
  Divider,
} from '@mantine/core';
import {
  IconPlayerPlay,
  IconCheck,
  IconLock,
  IconAlertTriangle,
  IconWriting,
} from '@tabler/icons-react';
import { Tooltip } from '@mantine/core';
import { api } from '../../utils/api';
import {
  MetadataSourcesSection,
  type MetadataProviderStatus,
} from '../../components/MetadataSourcesSection';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldConfigItem {
  field: string;
  provider: string;
  enabled: boolean;
}

interface Library {
  id: string;
  name: string;
}

interface Shelf {
  id: string;
  name: string;
}

interface Candidate {
  openLibraryKey: string;
  title: string;
  authors: string[];
  year?: number;
  coverUrl?: string;
  isbn13?: string;
}

interface GuidedSelection {
  bookId: string;
  openLibraryKey: string;
  isbn13?: string;
}

interface AmbiguousBook {
  bookId: string;
  bookTitle: string;
  candidates: Candidate[];
  selected: GuidedSelection | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  description: 'Description',
  authors: 'Authors',
  publisher: 'Publisher',
  publishedDate: 'Published Date',
  language: 'Language',
  isbn13: 'ISBN-13',
  isbn10: 'ISBN-10',
  pageCount: 'Page Count',
  genres: 'Genres',
  tags: 'Tags',
  seriesName: 'Series Name',
  googleBooksId: 'Google Books ID',
  openLibraryId: 'Open Library ID',
  goodreadsId: 'Goodreads ID',
  goodreadsRating: 'Goodreads Rating',
  asin: 'ASIN',
};

const PROVIDER_OPTIONS = [
  { value: 'open-library', label: 'Open Library' },
  { value: 'google-books', label: 'Google Books' },
  { value: 'goodreads', label: 'Goodreads' },
  { value: 'hardcover', label: 'Hardcover' },
];

const PROVIDER_COLORS: Record<string, string> = {
  'open-library': 'teal',
  'google-books': 'blue',
  goodreads: 'green',
  hardcover: 'orange',
};

// ── Field Config Section ───────────────────────────────────────────────────────

function ProviderDot({ provider }: { provider: string }) {
  return (
    <Box
      w={8}
      h={8}
      style={{
        borderRadius: '50%',
        flexShrink: 0,
        background: `var(--mantine-color-${PROVIDER_COLORS[provider] ?? 'gray'}-5)`,
      }}
    />
  );
}

function FieldConfigSection({
  enabledProviderIds,
}: {
  enabledProviderIds: string[];
}) {
  const [config, setConfig] = useState<FieldConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Track previous enabledProviderIds to detect removals
  const prevEnabledRef = useRef<string[]>([]);

  useEffect(() => {
    api
      .get<FieldConfigItem[]>('/admin/metadata-match/config')
      .then((r) => setConfig(r.data))
      .finally(() => setLoading(false));
  }, []);

  // Auto-remap fields whose provider was just disabled
  useEffect(() => {
    if (!enabledProviderIds.length || loading) return;
    const prev = prevEnabledRef.current;
    const removed = prev.filter((id) => !enabledProviderIds.includes(id));
    if (removed.length === 0) {
      prevEnabledRef.current = enabledProviderIds;
      return;
    }
    const fallback = enabledProviderIds[0];
    if (!fallback) return;
    setConfig((c) =>
      c.map((item) =>
        removed.includes(item.provider)
          ? { ...item, provider: fallback }
          : item,
      ),
    );
    prevEnabledRef.current = enabledProviderIds;
  }, [enabledProviderIds, loading]);

  // Filtered provider options — only show enabled sources
  const providerOptions = PROVIDER_OPTIONS.filter(
    (o) =>
      enabledProviderIds.length === 0 || enabledProviderIds.includes(o.value),
  );

  const isbnItem = config.find((c) => c.field === 'isbn13');
  const otherItems = config.filter((c) => c.field !== 'isbn13');

  function setFieldProvider(field: string, provider: string) {
    setConfig((prev) =>
      prev.map((item) => (item.field === field ? { ...item, provider } : item)),
    );
  }

  function setFieldEnabled(field: string, enabled: boolean) {
    setConfig((prev) =>
      prev.map((item) => (item.field === field ? { ...item, enabled } : item)),
    );
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await api.put('/admin/metadata-match/config', { config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Stack gap="xs">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} height={44} radius="sm" />
        ))}
      </Stack>
    );
  }

  const headerRow = (
    <Group
      px="sm"
      py={4}
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Text size="xs" fw={600} style={{ flex: 1 }}>
        Field
      </Text>
      <Text size="xs" fw={600} w={170}>
        Provider
      </Text>
      <Text size="xs" fw={600} w={80} ta="center">
        Enabled
      </Text>
    </Group>
  );

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        Choose which provider supplies each field. ISBN-13 is always resolved
        first — the resolved value is passed as a lookup hint to every
        subsequent provider call. Toggle fields off to skip them during
        enrichment.
      </Text>

      {/* ── ISBN-13 pinned row ── */}
      {isbnItem && (
        <Box
          p="xs"
          style={{
            borderRadius: 6,
            background:
              'light-dark(var(--mantine-color-teal-0), var(--mantine-color-teal-9))',
            border: '1px solid var(--mantine-color-teal-4)',
          }}
        >
          <Stack gap={4}>
            <Group gap="xs">
              <IconLock size={12} color="var(--mantine-color-teal-6)" />
              <Text size="xs" fw={600} c="teal">
                ISBN-13 — resolved first, used to chain providers
              </Text>
            </Group>
            {headerRow}
            <Group px="sm" py={4}>
              <Text size="sm" style={{ flex: 1 }} fw={500}>
                ISBN-13
              </Text>
              <Select
                value={isbnItem.provider}
                onChange={(v) => v && setFieldProvider('isbn13', v)}
                data={providerOptions}
                size="xs"
                w={170}
                leftSection={<ProviderDot provider={isbnItem.provider} />}
              />
              <Box w={80} style={{ display: 'flex', justifyContent: 'center' }}>
                <Switch
                  checked={isbnItem.enabled}
                  onChange={(e) =>
                    setFieldEnabled('isbn13', e.currentTarget.checked)
                  }
                  size="sm"
                />
              </Box>
            </Group>
          </Stack>
        </Box>
      )}

      <Divider label="Remaining fields" labelPosition="left" />

      {headerRow}

      {otherItems.map((item) => (
        <Group
          key={item.field}
          px="sm"
          py={4}
          style={{
            borderBottom: '1px solid var(--mantine-color-default-border)',
            opacity: item.enabled ? 1 : 0.45,
          }}
        >
          <Text size="sm" style={{ flex: 1 }}>
            {FIELD_LABELS[item.field] ?? item.field}
          </Text>
          <Select
            value={item.provider}
            onChange={(v) => v && setFieldProvider(item.field, v)}
            data={providerOptions}
            size="xs"
            w={170}
            leftSection={<ProviderDot provider={item.provider} />}
          />
          <Box w={80} style={{ display: 'flex', justifyContent: 'center' }}>
            <Switch
              checked={item.enabled}
              onChange={(e) =>
                setFieldEnabled(item.field, e.currentTarget.checked)
              }
              size="sm"
            />
          </Box>
        </Group>
      ))}

      <Group justify="flex-end" mt="xs">
        <Button
          size="xs"
          onClick={() => void handleSave()}
          loading={saving}
          leftSection={saved ? <IconCheck size={14} /> : undefined}
          color={saved ? 'green' : undefined}
        >
          {saved ? 'Saved' : 'Save Configuration'}
        </Button>
      </Group>
    </Stack>
  );
}

// ── Throttle Section ───────────────────────────────────────────────────────────

function ThrottleSection() {
  const [throttleMs, setThrottleMs] = useState<number>(500);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ throttleMs: number }>('/admin/metadata-match/throttle')
      .then((r) => setThrottleMs(r.data.throttleMs))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.put('/admin/metadata-match/throttle', { throttleMs });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton height={60} radius="sm" />;

  return (
    <Group align="flex-end" gap="sm">
      <NumberInput
        label="Delay between API calls (ms)"
        description="Rate-limit protection — 50 to 5000ms"
        value={throttleMs}
        onChange={(v) => typeof v === 'number' && setThrottleMs(v)}
        min={50}
        max={5000}
        step={100}
        w={260}
      />
      <Button size="sm" onClick={() => void handleSave()} loading={saving}>
        Save
      </Button>
    </Group>
  );
}

// ── Disambiguation Modal ──────────────────────────────────────────────────────

interface DisambiguationModalProps {
  opened: boolean;
  ambiguous: AmbiguousBook[];
  onUpdate: (bookId: string, selection: GuidedSelection | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function DisambiguationModal({
  opened,
  ambiguous,
  onUpdate,
  onConfirm,
  onCancel,
}: DisambiguationModalProps) {
  const [currentIdx, setCurrentIdx] = useState(0);

  const current = ambiguous[currentIdx];
  if (!current) return null;

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={`Disambiguate: "${current.bookTitle}" (${currentIdx + 1} of ${ambiguous.length})`}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          OpenLibrary found multiple matches. Choose the correct edition, or
          skip to use the top result automatically.
        </Text>

        <SimpleGrid cols={Math.min(3, current.candidates.length)} spacing="sm">
          {current.candidates.map((c) => {
            const isSelected =
              current.selected?.openLibraryKey === c.openLibraryKey;
            return (
              <Card
                key={c.openLibraryKey}
                withBorder
                padding="sm"
                radius="md"
                style={{
                  cursor: 'pointer',
                  border: isSelected
                    ? '2px solid var(--mantine-color-blue-5)'
                    : undefined,
                }}
                onClick={() =>
                  onUpdate(current.bookId, {
                    bookId: current.bookId,
                    openLibraryKey: c.openLibraryKey,
                    isbn13: c.isbn13,
                  })
                }
              >
                <Stack gap="xs" align="center">
                  {c.coverUrl ? (
                    <img
                      src={c.coverUrl}
                      alt={c.title}
                      style={{
                        width: 60,
                        height: 90,
                        objectFit: 'cover',
                        borderRadius: 4,
                      }}
                    />
                  ) : (
                    <Box
                      w={60}
                      h={90}
                      style={{
                        background: 'var(--mantine-color-gray-2)',
                        borderRadius: 4,
                      }}
                    />
                  )}
                  <Text size="xs" fw={500} lineClamp={2} ta="center">
                    {c.title}
                  </Text>
                  {c.authors.length > 0 && (
                    <Text size="xs" c="dimmed" lineClamp={1} ta="center">
                      {c.authors.join(', ')}
                    </Text>
                  )}
                  {c.year && (
                    <Badge size="xs" variant="outline">
                      {c.year}
                    </Badge>
                  )}
                  {c.isbn13 && (
                    <Text size="xs" c="dimmed">
                      {c.isbn13}
                    </Text>
                  )}
                  {isSelected && (
                    <Badge size="xs" color="blue">
                      Selected
                    </Badge>
                  )}
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>

        <Group justify="space-between">
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              onUpdate(current.bookId, null); // skip = no guided selection
              if (currentIdx < ambiguous.length - 1) {
                setCurrentIdx((i) => i + 1);
              } else {
                onConfirm();
              }
            }}
          >
            Skip (use top result)
          </Button>
          <Group gap="xs">
            {currentIdx > 0 && (
              <Button
                variant="default"
                size="sm"
                onClick={() => setCurrentIdx((i) => i - 1)}
              >
                Back
              </Button>
            )}
            {currentIdx < ambiguous.length - 1 ? (
              <Button
                size="sm"
                onClick={() => setCurrentIdx((i) => i + 1)}
                disabled={!current.selected}
              >
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={onConfirm}>
                Start Run
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── Run Section ───────────────────────────────────────────────────────────────

const GUIDED_MODE_KEY = 'metadata_match_guided_mode';

function RunSection({ onRunStarted }: { onRunStarted?: () => void }) {
  const [scope, setScope] = useState<'all' | 'library' | 'shelf'>('all');
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [guidedMode, setGuidedMode] = useState<boolean>(
    () => localStorage.getItem(GUIDED_MODE_KEY) !== 'false',
  );
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [started, setStarted] = useState(false);
  const [ambiguous, setAmbiguous] = useState<AmbiguousBook[]>([]);
  const [disambigOpen, setDisambigOpen] = useState(false);
  const [guidedSelections, setGuidedSelections] = useState<
    Map<string, GuidedSelection>
  >(new Map());

  function handleGuidedModeChange(v: boolean) {
    setGuidedMode(v);
    localStorage.setItem(GUIDED_MODE_KEY, String(v));
  }

  useEffect(() => {
    void api.get<Library[]>('/libraries').then((r) => setLibraries(r.data));
    void api.get<Shelf[]>('/shelves').then((r) => setShelves(r.data));
  }, []);

  async function getBookIdsForScope(): Promise<string[]> {
    if (scope === 'all') {
      const res = await api.get<{ id: string }[]>('/books?limit=10000');
      return res.data.map((b) => b.id);
    }
    if (scope === 'library' && scopeId) {
      const res = await api.get<{ id: string }[]>(
        `/books?libraryId=${scopeId}&limit=10000`,
      );
      return res.data.map((b) => b.id);
    }
    if (scope === 'shelf' && scopeId) {
      const res = await api.get<{ id: string }[]>(
        `/shelves/${scopeId}/books?limit=10000`,
      );
      return res.data.map((b) => b.id);
    }
    return [];
  }

  async function handleRun() {
    if (scope !== 'all' && !scopeId) return;
    setPreparing(true);
    setStarted(false);

    try {
      const bookIds = await getBookIdsForScope();

      if (guidedMode && bookIds.length <= 50) {
        const results = await Promise.allSettled(
          bookIds.map(async (bookId) => {
            const res = await api.post<Candidate[]>(
              '/admin/metadata-match/candidates',
              {
                bookId,
                limit: 3,
              },
            );
            if (res.data.length <= 1) return null;
            const bookRes = await api.get<{ title: string }>(
              `/books/${bookId}`,
            );
            return {
              bookId,
              bookTitle: bookRes.data.title,
              candidates: res.data,
            };
          }),
        );
        const ambiguousBooks: AmbiguousBook[] = results
          .filter(
            (
              r,
            ): r is PromiseFulfilledResult<{
              bookId: string;
              bookTitle: string;
              candidates: Candidate[];
            }> => r.status === 'fulfilled' && r.value !== null,
          )
          .map((r) => ({ ...r.value, selected: null }));

        if (ambiguousBooks.length > 0) {
          setAmbiguous(ambiguousBooks);
          setGuidedSelections(new Map());
          setPreparing(false);
          setDisambigOpen(true);
          return;
        }
      }

      await submitRun([]);
    } finally {
      setPreparing(false);
    }
  }

  async function submitRun(selections: GuidedSelection[]) {
    await api.post('/admin/metadata-match/run', {
      scope,
      scopeId: scopeId ?? undefined,
      overwrite,
      guidedSelections: selections.length > 0 ? selections : undefined,
    });
    setStarted(true);
    onRunStarted?.();
  }

  function handleDisambigUpdate(
    bookId: string,
    selection: GuidedSelection | null,
  ) {
    setGuidedSelections((prev) => {
      const next = new Map(prev);
      if (selection) next.set(bookId, selection);
      else next.delete(bookId);
      return next;
    });
    setAmbiguous((prev) =>
      prev.map((b) =>
        b.bookId === bookId ? { ...b, selected: selection } : b,
      ),
    );
  }

  async function handleDisambigConfirm() {
    setDisambigOpen(false);
    setPreparing(true);
    try {
      await submitRun([...guidedSelections.values()]);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <Stack gap="md">
        <Stack gap="xs">
          <Select
            label="Scope"
            value={scope}
            onChange={(v) => {
              setScope((v as 'all' | 'library' | 'shelf') ?? 'all');
              setScopeId(null);
            }}
            data={[
              { value: 'all', label: 'All Books' },
              { value: 'library', label: 'Specific Library' },
              { value: 'shelf', label: 'Specific Shelf' },
            ]}
            w={220}
          />

          {scope === 'library' && (
            <Select
              label="Library"
              value={scopeId}
              onChange={setScopeId}
              data={libraries.map((l) => ({ value: l.id, label: l.name }))}
              placeholder="Select a library..."
              w={280}
            />
          )}

          {scope === 'shelf' && (
            <Select
              label="Shelf"
              value={scopeId}
              onChange={setScopeId}
              data={shelves.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Select a shelf..."
              w={280}
            />
          )}

          <Switch
            label="Overwrite existing values"
            description="By default only empty fields are filled. Enable this to replace all matched fields."
            checked={overwrite}
            onChange={(e) => setOverwrite(e.currentTarget.checked)}
          />
          <Switch
            label="Guided mode — choose from top 3 candidates"
            description="For runs with 50 books or fewer, show Open Library candidates and let you pick before the run starts. Disable to always use the top result automatically."
            checked={guidedMode}
            onChange={(e) => handleGuidedModeChange(e.currentTarget.checked)}
          />
        </Stack>

        <Group>
          <Button
            leftSection={<IconPlayerPlay size={16} />}
            onClick={() => void handleRun()}
            loading={preparing}
            disabled={scope !== 'all' && !scopeId}
          >
            Run Bulk Enrichment
          </Button>
        </Group>

        {started && (
          <Alert icon={<IconCheck size={16} />} color="green" variant="light">
            Run started — check the <strong>Tasks</strong> tab for live
            progress.
          </Alert>
        )}
      </Stack>

      <DisambiguationModal
        key={disambigOpen ? ambiguous.length : 0}
        opened={disambigOpen}
        ambiguous={ambiguous}
        onUpdate={handleDisambigUpdate}
        onConfirm={() => void handleDisambigConfirm()}
        onCancel={() => setDisambigOpen(false)}
      />
    </>
  );
}

// ── Auto-Write Epub Section ───────────────────────────────────────────────────

function AutoWriteEpubSection() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [diskSettings, setDiskSettings] = useState<{
    allowDiskWrites: boolean;
    isReadOnlyMount: boolean;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      api
        .get<{ enabled: boolean }>('/admin/metadata-match/settings/auto-write')
        .then((r) => setEnabled(r.data.enabled)),
      api
        .get<{
          allowDiskWrites: boolean;
          isReadOnlyMount: boolean;
        }>('/admin/settings/disk')
        .then((r) => setDiskSettings(r.data)),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(val: boolean) {
    setEnabled(val);
    try {
      await api.put('/admin/metadata-match/settings/auto-write', {
        enabled: val,
      });
    } catch {
      setEnabled(!val);
    }
  }

  if (loading) return <Skeleton height={44} radius="sm" />;

  const writesAllowed =
    !!diskSettings?.allowDiskWrites && !diskSettings?.isReadOnlyMount;

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        When enabled, every enrichment run will also write the updated metadata
        directly into the epub file on disk. Only epub files are written.
        Requires disk writes to be enabled and the library directory to be
        writable.
      </Text>

      {diskSettings?.isReadOnlyMount && (
        <Alert
          icon={<IconLock size={14} />}
          color="yellow"
          variant="light"
          py="xs"
        >
          Library directory is mounted read-only — this setting will have no
          effect.
        </Alert>
      )}

      <Tooltip
        label={
          !diskSettings?.allowDiskWrites
            ? 'Enable disk writes in Admin → General first'
            : diskSettings?.isReadOnlyMount
              ? 'Library directory is read-only'
              : ''
        }
        disabled={writesAllowed}
      >
        <span style={{ width: 'fit-content' }}>
          <Switch
            label="Auto-write metadata to epub after enrichment"
            checked={enabled}
            onChange={(e) => void handleToggle(e.currentTarget.checked)}
            disabled={!writesAllowed}
          />
        </span>
      </Tooltip>
    </Stack>
  );
}

// ── Bulk Sidecar Section ──────────────────────────────────────────────────────

interface DiskSettings {
  allowDiskWrites: boolean;
  isReadOnlyMount: boolean;
}

function BulkSidecarSection({ onRunStarted }: { onRunStarted?: () => void }) {
  const [diskSettings, setDiskSettings] = useState<DiskSettings | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    api
      .get<DiskSettings>('/admin/settings/disk')
      .then((r) => setDiskSettings(r.data))
      .catch(() => {});
  }, []);

  async function handleBulkWrite() {
    setRunning(true);
    setResult(null);
    try {
      await api.post('/admin/sidecar/bulk-write');
      setResult('success');
      onRunStarted?.();
    } catch {
      setResult('error');
    } finally {
      setRunning(false);
    }
  }

  if (!diskSettings) return <Skeleton height={60} radius="sm" />;

  const writesEnabled = diskSettings.allowDiskWrites;

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Write a <code>.metadata.json</code> sidecar file alongside every ebook
        in the library. Ebook files are never modified. Enable disk writes in{' '}
        <strong>General → Disk Writes</strong> first.
      </Text>

      {diskSettings.isReadOnlyMount && (
        <Alert
          icon={<IconLock size={14} />}
          color="yellow"
          variant="light"
          py="xs"
        >
          Library directory is mounted read-only — writes will fail.
        </Alert>
      )}

      {result === 'success' && (
        <Alert
          icon={<IconCheck size={14} />}
          color="green"
          variant="light"
          py="xs"
        >
          Bulk sidecar write started — check the <strong>Tasks</strong> tab for
          progress.
        </Alert>
      )}
      {result === 'error' && (
        <Alert
          icon={<IconAlertTriangle size={14} />}
          color="red"
          variant="light"
          py="xs"
        >
          Failed to start. Check that disk writes are enabled in Admin →
          General.
        </Alert>
      )}

      <Tooltip
        label="Enable disk writes in Admin → General first"
        disabled={writesEnabled}
      >
        <Button
          leftSection={<IconWriting size={16} />}
          onClick={() => void handleBulkWrite()}
          loading={running}
          disabled={!writesEnabled}
          w="fit-content"
        >
          Write All Sidecars
        </Button>
      </Tooltip>
    </Stack>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function MetadataMatchingPage({
  onRunStarted,
}: { onRunStarted?: () => void } = {}) {
  const [enabledProviderIds, setEnabledProviderIds] = useState<string[]>([]);

  function handleProvidersChange(providers: MetadataProviderStatus[]) {
    setEnabledProviderIds(providers.filter((p) => p.enabled).map((p) => p.id));
  }

  return (
    <Stack gap="lg">
      <MetadataSourcesSection onProvidersChange={handleProvidersChange} />

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Field Sources</Title>
          <FieldConfigSection enabledProviderIds={enabledProviderIds} />
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Request Throttle</Title>
          <Text size="sm" c="dimmed">
            Delay between consecutive API calls to avoid triggering rate limits.
          </Text>
          <ThrottleSection />
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Run Bulk Enrichment</Title>
          <Text size="sm" c="dimmed">
            Run metadata enrichment across your entire library, a specific
            library, or a specific shelf.
          </Text>
          <RunSection onRunStarted={onRunStarted} />
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Auto-Write Epub on Enrichment</Title>
          <AutoWriteEpubSection />
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={4}>Bulk Sidecar Write</Title>
          <BulkSidecarSection onRunStarted={onRunStarted} />
        </Stack>
      </Paper>
    </Stack>
  );
}
