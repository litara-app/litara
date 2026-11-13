import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
  Portal,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconX,
  IconSearch,
  IconKeyboard,
  IconBookmark,
  IconBookmarkFilled,
  IconList,
} from '@tabler/icons-react';
import { api } from '../utils/api';
import { useBookAnnotations } from '../hooks/useBookAnnotations';
import { HighlightPopover } from '../components/Reader/HighlightPopover';
import { AnnotationsSidebar } from '../components/Reader/AnnotationsSidebar';
import type { Annotation, AnnotationType } from '../api/annotations';

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

interface PendingSelection {
  cfi: string | null;
  text: string;
}

export function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { state: locationState } = useLocation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeReady = useRef(false);
  const bookReady = useRef(false);
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
  const [showSidebar, setShowSidebar] = useState(false);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [clickedAnnotation, setClickedAnnotation] = useState<Annotation | null>(
    null,
  );
  const [popoverPosition, setPopoverPosition] = useState({
    top: 80,
    left: 200,
  });

  const { annotations, createAnnotation, updateAnnotation, deleteAnnotation } =
    useBookAnnotations(bookId);

  // Current page CFI — kept as state so the bookmark button re-renders on page change
  const [currentCfi, setCurrentCfi] = useState<string | null>(null);
  const currentBookmark = annotations.find(
    (a) => a.type === 'BOOKMARK' && a.location === currentCfi,
  );

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
            source: 'LITARA',
          })
          .catch(() => {
            /* silent */
          });
      }, 1000);
    },
    [bookId],
  );

  // Flush progress on unmount / unload
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
        source: 'LITARA',
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

  // Load annotations into iframe after book is ready
  const loadAnnotationsIntoIframe = useCallback(
    (anns: Annotation[]) => {
      send({
        type: 'loadAnnotations',
        annotations: anns.map((a) => ({
          id: a.id,
          cfi: a.location,
          type: a.type,
          color: a.color,
        })),
      });
    },
    [send],
  );

  // Listen for messages from iframe
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const { type, cfi, fraction, message, action, text, annotationId } =
        e.data || {};
      if (type === 'iframeReady') {
        iframeReady.current = true;
        // If navigated here from the annotations page, jump directly to that CFI.
        const jumpCfi = (locationState as { cfi?: string } | null)?.cfi ?? null;
        let openCfi: string | null = jumpCfi;
        if (!openCfi) {
          try {
            const res = await api.get<{ location: string } | null>(
              `/books/${bookId}/progress?source=LITARA`,
            );
            openCfi = res.data?.location ?? null;
          } catch {
            /* ignore network errors */
          }
        }
        await openBook(openCfi);
      } else if (type === 'ready') {
        // Book (or a new section) is loaded. Mark ready and sync annotations.
        bookReady.current = true;
        loadAnnotationsIntoIframe(annotations);
      } else if (type === 'relocate') {
        if (cfi) {
          setCurrentCfi(cfi as string);
          saveProgress(cfi as string, (fraction as number) ?? 0);
        }
      } else if (type === 'currentCfi') {
        // Response to a bookmark toggle request
        const bookmarkCfi = (e.data as { cfi: string | null }).cfi;
        if (!bookmarkCfi) return;
        const existing = annotations.find(
          (a) => a.type === 'BOOKMARK' && a.location === bookmarkCfi,
        );
        if (existing) {
          await deleteAnnotation(existing.id);
          send({ type: 'removeAnnotation', id: existing.id });
        } else {
          const ann = await createAnnotation({
            location: bookmarkCfi,
            type: 'BOOKMARK' as AnnotationType,
          });
          send({
            type: 'addAnnotation',
            id: ann.id,
            cfi: ann.location,
            annotationType: ann.type,
            color: null,
          });
        }
      } else if (type === 'textSelected') {
        // Show highlight popover near the top-left of the iframe area
        const iframeRect = iframeRef.current?.getBoundingClientRect();
        if (iframeRect) {
          setPopoverPosition({
            top: iframeRect.top + 60,
            left: iframeRect.left + 40,
          });
        }
        setPendingSelection({
          cfi: cfi as string | null,
          text: text as string,
        });
        setClickedAnnotation(null);
      } else if (type === 'annotationClicked') {
        const ann = annotations.find((a) => a.id === annotationId);
        if (ann) {
          const iframeRect = iframeRef.current?.getBoundingClientRect();
          if (iframeRect) {
            setPopoverPosition({
              top: iframeRect.top + 60,
              left: iframeRect.left + 40,
            });
          }
          setClickedAnnotation(ann);
          setPendingSelection(null);
        }
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
  }, [
    bookId,
    openBook,
    saveProgress,
    prefs,
    annotations,
    createAnnotation,
    deleteAnnotation,
    loadAnnotationsIntoIframe,
  ]);

  // When annotations finish loading and the book is already ready, sync them to the iframe.
  // This handles the race where ready fires before the annotation API call completes.
  useEffect(() => {
    if (bookReady.current && annotations.length > 0) {
      loadAnnotationsIntoIframe(annotations);
    }
  }, [annotations, loadAnnotationsIntoIframe]);

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
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === 'ArrowRight') send({ type: 'next' });
      else if (e.key === 'ArrowLeft') send({ type: 'prev' });
      else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        send({ type: 'openSearch' });
      } else if (e.key === 'Escape' && !showHelp) {
        if (pendingSelection || clickedAnnotation) {
          setPendingSelection(null);
          setClickedAnnotation(null);
        } else {
          navigate(-1);
        }
      } else if (e.key === '?' && !showHelp) setShowHelp(true);
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
  }, [send, navigate, prefs, showHelp, pendingSelection, clickedAnnotation]);

  function handleBookmarkToggle() {
    send({ type: 'getCurrentCfi' });
  }

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

        <Tooltip
          label={currentBookmark ? 'Remove bookmark' : 'Bookmark this page'}
        >
          <ActionIcon
            variant="subtle"
            color={currentBookmark ? 'yellow' : 'gray'}
            onClick={handleBookmarkToggle}
          >
            {currentBookmark ? (
              <IconBookmarkFilled size={18} />
            ) : (
              <IconBookmark size={18} />
            )}
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Annotations">
          <ActionIcon
            variant={showSidebar ? 'filled' : 'subtle'}
            color="gray"
            onClick={() => setShowSidebar((v) => !v)}
          >
            <IconList size={18} />
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

      {/* Reader area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Reader iframe */}
        <iframe
          ref={iframeRef}
          src="/reader.html"
          sandbox="allow-scripts allow-same-origin"
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Ebook reader"
        />

        {/* Floating highlight popover for new selection */}
        {pendingSelection && (
          <Portal>
            <div
              style={{
                position: 'fixed',
                top: popoverPosition.top,
                left: popoverPosition.left,
                zIndex: 300,
              }}
            >
              <HighlightPopover
                existingAnnotation={null}
                onSave={async (data) => {
                  if (!pendingSelection.cfi) return;
                  const ann = await createAnnotation({
                    location: pendingSelection.cfi,
                    type: data.type,
                    text: pendingSelection.text,
                    note: data.note,
                    color: data.color,
                  });
                  send({
                    type: 'addAnnotation',
                    id: ann.id,
                    cfi: ann.location,
                    annotationType: ann.type,
                    color: ann.color,
                  });
                  setPendingSelection(null);
                }}
                onCancel={() => setPendingSelection(null)}
              />
            </div>
          </Portal>
        )}

        {/* Floating popover for existing annotation click */}
        {clickedAnnotation && (
          <Portal>
            <div
              style={{
                position: 'fixed',
                top: popoverPosition.top,
                left: popoverPosition.left,
                zIndex: 300,
              }}
            >
              <HighlightPopover
                existingAnnotation={clickedAnnotation}
                onSave={async (data) => {
                  await updateAnnotation(clickedAnnotation.id, {
                    type: data.type,
                    color: data.color,
                    note: data.note,
                  });
                  setClickedAnnotation(null);
                }}
                onDelete={async () => {
                  send({ type: 'removeAnnotation', id: clickedAnnotation.id });
                  await deleteAnnotation(clickedAnnotation.id);
                  setClickedAnnotation(null);
                }}
                onCancel={() => setClickedAnnotation(null)}
              />
            </div>
          </Portal>
        )}

        {/* Annotations sidebar */}
        {showSidebar && (
          <AnnotationsSidebar
            annotations={annotations}
            onJump={(cfi) => send({ type: 'goto', cfi })}
            onDelete={async (id) => {
              send({ type: 'removeAnnotation', id });
              await deleteAnnotation(id);
            }}
            onClose={() => setShowSidebar(false)}
          />
        )}
      </div>

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
