import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  Group,
  Select,
  Tooltip,
  useComputedColorScheme,
  Modal,
  Table,
  Text,
  Kbd,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconX,
  IconSearch,
  IconKeyboard,
} from '@tabler/icons-react';
import { api } from '../utils/api';

const STORAGE_KEY = 'reader-prefs';

interface ReaderPrefs {
  theme: 'light' | 'sepia' | 'dark';
  fontSize: number;
}

function loadSavedPrefs(): ReaderPrefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ReaderPrefs;
  } catch {
    /* ignore */
  }
  return null;
}

function savePrefs(prefs: ReaderPrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

const FONT_SIZES = [12, 14, 16, 18, 20, 24];

const SHORTCUTS: Array<{ keys: string[]; description: string }> = [
  { keys: ['→', '←'], description: 'Next / previous page' },
  { keys: ['Space'], description: 'Next page' },
  { keys: ['Shift + Space'], description: 'Previous page' },
  { keys: ['f', 'Ctrl + F'], description: 'Open search' },
  { keys: ['Enter'], description: 'Next search result' },
  { keys: ['Shift + Enter'], description: 'Previous search result' },
  { keys: ['Escape'], description: 'Close search / exit reader' },
  { keys: ['+', '='], description: 'Increase font size' },
  { keys: ['-'], description: 'Decrease font size' },
  { keys: ['1'], description: 'Light theme' },
  { keys: ['2'], description: 'Sepia theme' },
  { keys: ['3'], description: 'Dark theme' },
  { keys: ['?'], description: 'Show this keyboard shortcuts panel' },
];

export function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeReady = useRef(false);
  const lastCfi = useRef<string | null>(null);
  const lastFraction = useRef<number | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const computedScheme = useComputedColorScheme('light');

  const [prefs, setPrefs] = useState<ReaderPrefs>(() => {
    const saved = loadSavedPrefs();
    if (saved) return saved;
    return {
      theme: computedScheme === 'dark' ? 'dark' : 'light',
      fontSize: 16,
    };
  });

  const [showHelp, setShowHelp] = useState(false);

  // Send a command to the iframe
  const send = useCallback((msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  }, []);

  // Open the book once the iframe is ready
  const openBook = useCallback(
    async (cfi: string | null) => {
      const url = `${import.meta.env.VITE_API_URL ?? '/api/v1'}/books/${bookId}/file`;
      send({ type: 'setTheme', theme: prefs.theme });
      send({ type: 'setFontSize', size: prefs.fontSize });
      send({ type: 'open', url, cfi });
    },
    [bookId, prefs, send],
  );

  // Debounced progress save
  const saveProgress = useCallback(
    (cfi: string, fraction: number) => {
      lastCfi.current = cfi;
      lastFraction.current = fraction;
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        api
          .patch(`/books/${bookId}/progress`, {
            location: cfi,
            percentage: fraction,
          })
          .catch(() => {
            /* silent */
          });
      }, 1000);
    },
    [bookId],
  );

  // Flush progress on unmount / unload
  // keepalive: true lets the request outlive the page; unlike sendBeacon it supports headers
  const flushProgress = useCallback(() => {
    if (!lastCfi.current || !bookId) return;
    const url = `${import.meta.env.VITE_API_URL ?? '/api/v1'}/books/${bookId}/progress`;
    const token = localStorage.getItem('token');
    fetch(url, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        location: lastCfi.current,
        percentage: lastFraction.current,
      }),
    }).catch(() => {
      /* silent */
    });
  }, [bookId]);

  function updatePrefs(patch: Partial<ReaderPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
    if ('theme' in patch) send({ type: 'setTheme', theme: patch.theme });
    if ('fontSize' in patch)
      send({ type: 'setFontSize', size: patch.fontSize });
  }

  // Listen for messages from iframe
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const { type, cfi, fraction, message, action } = e.data || {};
      if (type === 'iframeReady') {
        iframeReady.current = true;
        let savedCfi: string | null = null;
        try {
          const res = await api.get<{ location: string } | null>(
            `/books/${bookId}/progress`,
          );
          savedCfi = res.data?.location ?? null;
        } catch {
          /* ignore network errors */
        }
        await openBook(savedCfi);
      } else if (type === 'relocate') {
        if (cfi) saveProgress(cfi as string, (fraction as number) ?? 0);
      } else if (type === 'error') {
        console.error('Reader error:', message);
      } else if (type === 'escape') {
        navigate(-1);
      } else if (type === 'keyAction') {
        switch (action as string) {
          case 'fontSizeUp': {
            const idx = FONT_SIZES.indexOf(prefs.fontSize);
            const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, idx + 1)];
            if (next !== prefs.fontSize) updatePrefs({ fontSize: next });
            break;
          }
          case 'fontSizeDown': {
            const idx = FONT_SIZES.indexOf(prefs.fontSize);
            const next = FONT_SIZES[Math.max(0, idx - 1)];
            if (next !== prefs.fontSize) updatePrefs({ fontSize: next });
            break;
          }
          case 'themeLight':
            updatePrefs({ theme: 'light' });
            break;
          case 'themeSepia':
            updatePrefs({ theme: 'sepia' });
            break;
          case 'themeDark':
            updatePrefs({ theme: 'dark' });
            break;
          case 'showHelp':
            setShowHelp(true);
            break;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, openBook, saveProgress, prefs]);

  // Save on tab/window close
  useEffect(() => {
    window.addEventListener('beforeunload', flushProgress);
    return () => {
      window.removeEventListener('beforeunload', flushProgress);
      flushProgress();
    };
  }, [flushProgress]);

  // Parent-window keyboard shortcuts (toolbar focused)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === 'ArrowRight') send({ type: 'next' });
      else if (e.key === 'ArrowLeft') send({ type: 'prev' });
      else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        send({ type: 'openSearch' });
      } else if (e.key === 'Escape' && !showHelp) navigate(-1);
      else if (e.key === '?' && !showHelp) setShowHelp(true);
      else if (e.key === '+' || e.key === '=') {
        const idx = FONT_SIZES.indexOf(prefs.fontSize);
        const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, idx + 1)];
        if (next !== prefs.fontSize) updatePrefs({ fontSize: next });
      } else if (e.key === '-') {
        const idx = FONT_SIZES.indexOf(prefs.fontSize);
        const next = FONT_SIZES[Math.max(0, idx - 1)];
        if (next !== prefs.fontSize) updatePrefs({ fontSize: next });
      } else if (e.key === '1') updatePrefs({ theme: 'light' });
      else if (e.key === '2') updatePrefs({ theme: 'sepia' });
      else if (e.key === '3') updatePrefs({ theme: 'dark' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, navigate, prefs, showHelp]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#1a1a2e',
      }}
    >
      {/* Toolbar */}
      <Group
        px="sm"
        py={6}
        gap="xs"
        style={{
          background: '#111',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}
      >
        <Tooltip label="Back">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => navigate(-1)}
          >
            <IconArrowLeft size={18} />
          </ActionIcon>
        </Tooltip>

        <div style={{ flex: 1 }} />

        <Tooltip label="Previous page (←)">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => send({ type: 'prev' })}
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Next page (→)">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => send({ type: 'next' })}
          >
            <IconChevronRight size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Search (f)">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => send({ type: 'openSearch' })}
          >
            <IconSearch size={18} />
          </ActionIcon>
        </Tooltip>

        <Select
          size="xs"
          w={90}
          value={String(prefs.fontSize)}
          data={FONT_SIZES.map(String)}
          onChange={(v) => v && updatePrefs({ fontSize: Number(v) })}
          aria-label="Font size"
        />

        <Select
          size="xs"
          w={80}
          value={prefs.theme}
          data={[
            { value: 'light', label: 'Light' },
            { value: 'sepia', label: 'Sepia' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(v) =>
            v && updatePrefs({ theme: v as ReaderPrefs['theme'] })
          }
          aria-label="Theme"
        />

        <Tooltip label="Keyboard shortcuts (?)">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => setShowHelp(true)}
          >
            <IconKeyboard size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Close reader">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => navigate(-1)}
          >
            <IconX size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Reader iframe */}
      <iframe
        ref={iframeRef}
        src="/reader.html"
        sandbox="allow-scripts allow-same-origin"
        style={{ flex: 1, border: 'none', width: '100%' }}
        title="Ebook reader"
      />

      {/* Keyboard shortcuts help */}
      <Modal
        opened={showHelp}
        onClose={() => setShowHelp(false)}
        title="Keyboard shortcuts"
        size="sm"
      >
        <Table striped withRowBorders={false}>
          <Table.Tbody>
            {SHORTCUTS.map(({ keys, description }) => (
              <Table.Tr key={description}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  <Group gap={4} wrap="nowrap">
                    {keys.map((k) => (
                      <Kbd key={k} size="sm">
                        {k}
                      </Kbd>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{description}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Modal>
    </div>
  );
}
