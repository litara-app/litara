import { ActionIcon, Alert, Badge, Button, Drawer, Group, Modal, NavLink, SegmentedControl, Slider, Stack, Tabs, Text, Textarea, Tooltip } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { get } from "../api/client";
import type { Annotation, AnnotationData, Locator, Page, ReaderSnapshot } from "../api/types";
import { Busy, ErrorBox } from "../ui/common";
import { ComicReader } from "./ComicReader";
import { remoteSource } from "./fileSource";
import { loadReaderOrigin, ReaderHost, type PaintedAnnotation, type ReaderEvent, type ReaderKind, type ReaderStyle } from "./host";
import { useEditionPending, usePendingQueue, usePendingState } from "../pending/PendingProvider";
import { usePositionSaver } from "./usePositionSaver";

interface TocItem { label: string; href: string | null; items: TocItem[] }
interface Where { cfi: string | null; fraction: number | null; pageIndex?: number; numPages?: number; tocLabel: string | null }

const KINDS: Record<string, ReaderKind> = { epub: "epub", kepub: "epub", fb2: "fb2", pdf: "pdf", cbz: "cbz" };
const STYLE_KEY = "litara.reader.style";
const DEFAULT_STYLE: ReaderStyle = { fontPct: 100, theme: "light", flow: "paginated" };

function loadStyle(): ReaderStyle {
  try {
    const s = JSON.parse(localStorage.getItem(STYLE_KEY) ?? "null");
    if (s && typeof s === "object") return { ...DEFAULT_STYLE, ...s };
  } catch { /* storage unavailable: defaults */ }
  return DEFAULT_STYLE;
}

function TocList({ items, onPick }: { items: TocItem[]; onPick: (href: string) => void }) {
  return (
    <>
      {items.map((i, n) => (
        <NavLink key={`${n}-${i.label}`} label={i.label || "(untitled)"} defaultOpened={false} childrenOffset={14}
          onClick={() => i.href && onPick(i.href)}>
          {i.items.length > 0 && <TocList items={i.items} onPick={onPick} />}
        </NavLink>
      ))}
    </>
  );
}

export function ReaderPage() {
  const { editionId = "" } = useParams();
  const snapshot = useQuery({ queryKey: ["reader", editionId], queryFn: () => get<ReaderSnapshot>(`/editions/${editionId}/reader`), staleTime: Infinity, gcTime: 0 });
  if (snapshot.isPending) return <Busy />;
  if (snapshot.error) return <Stack p="md"><ErrorBox error={snapshot.error} /><Button component={Link} to="/" variant="default">Back to library</Button></Stack>;
  if (["cbz", "cbr", "cb7"].includes(snapshot.data.edition.file.format)) return <ComicReader snapshot={snapshot.data} />;
  return <Reader snapshot={snapshot.data} />;
}

function Reader({ snapshot }: { snapshot: ReaderSnapshot }) {
  const e = snapshot.edition;
  const kind = KINDS[e.file.format];
  const box = useRef<HTMLDivElement>(null);
  const hostRef = useRef<ReaderHost | null>(null);
  const qc = useQueryClient();
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [where, setWhere] = useState<Where>({ cfi: null, fraction: null, tocLabel: null });
  const [selection, setSelection] = useState<{ cfi: string; text: string } | null>(null);
  const [style, setStyle] = useState<ReaderStyle>(loadStyle);
  const [panel, setPanel] = useState(false);
  const [settings, setSettings] = useState(false);
  const [noteDraft, setNoteDraft] = useState<{ id?: string; text: string; selection: { cfi: string; text: string } | null } | null>(null);

  const saver = usePositionSaver({ editionId: e.id, fileId: e.file.id, contentVersion: e.file.contentVersion, initialRevision: snapshot.position.revision });

  // ---- annotations ----------------------------------------------------------
  const annKey = useMemo(() => ["annotations", e.id], [e.id]);
  const annotations = useQuery({ queryKey: annKey, queryFn: () => get<Page<Annotation>>(`/editions/${e.id}/annotations?includeDeleted=false&size=200`) });
  // Server state with this account's unsent writes laid over it, so nothing the
  // reader just did disappears, and nothing unsaved is presented as saved.
  const queue = usePendingQueue();
  const pendingOps = useEditionPending(e.id).filter((o) => o.kind === "annotation");
  type View = Annotation & { unsaved?: "pending" | "attention" };
  const view: View[] = useMemo(() => {
    const byId = new Map<string, View>((annotations.data?.items ?? []).map((a) => [a.id, a]));
    for (const o of pendingOps) {
      const id = o.resourceKey.slice("annotation:".length);
      const flag = o.status === "pending" ? "pending" : "attention";
      if (o.method === "DELETE") { const cur = byId.get(id); if (cur) byId.set(id, { ...cur, deleted: true, data: null }); continue; }
      const data = (o.body as { data: AnnotationData }).data;
      const cur = byId.get(id);
      byId.set(id, { id, editionId: e.id, revision: cur?.revision ?? "0", deleted: false, data, updatedAt: cur?.updatedAt ?? "", unsaved: flag });
    }
    return [...byId.values()];
  }, [annotations.data, pendingOps, e.id]);
  const live = useMemo(() => view.filter((a) => !a.deleted && a.data), [view]);
  const current = (a: Annotation) => a.data!.anchor.contentVersion === e.file.contentVersion;
  const refresh = () => qc.invalidateQueries({ queryKey: annKey });
  useEffect(() => queue.onSent((o) => { if (o.kind === "annotation") refresh(); }), [queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const serverRevision = (id: string) => Number(annotations.data?.items.find((x) => x.id === id)?.revision ?? "0");
  const putAnnotation = (id: string, data: AnnotationData, label: string) => {
    const opId = crypto.randomUUID();
    void queue.enqueue({
      id: opId, kind: "annotation", resourceKey: `annotation:${id}`, editionId: e.id, method: "PUT", path: `/editions/${e.id}/annotations/${id}`, label,
      confirmedRevision: serverRevision(id),
      body: (base) => ({ operationId: opId, baseRevision: base, capturedAt: new Date().toISOString(), data }),
    });
  };
  const removeAnnotation = (a: Annotation) => {
    const opId = crypto.randomUUID();
    void queue.enqueue({
      id: opId, kind: "annotation", resourceKey: `annotation:${a.id}`, editionId: e.id, method: "DELETE", path: `/editions/${e.id}/annotations/${a.id}`, label: "Delete annotation",
      confirmedRevision: serverRevision(a.id),
      body: (base) => ({ operationId: opId, baseRevision: base, capturedAt: new Date().toISOString() }),
    });
  };
  const anchorAt = (locator: Locator) => ({ fileId: e.file.id, contentVersion: e.file.contentVersion, locator });
  const cfiLoc = (cfi: string): Locator => ({ kind: "foliate-cfi", version: 1, cfi });
  const hereLocator = (): Locator | null => {
    if (kind === "pdf") return where.pageIndex === undefined ? null : { kind: "pdf-page", version: 1, pageIndex: where.pageIndex, x: 0, y: 0 };
    return where.cfi ? cfiLoc(where.cfi) : null;
  };
  const addBookmark = () => {
    const loc = hereLocator();
    if (loc) putAnnotation(crypto.randomUUID(), { kind: "bookmark", anchor: anchorAt(loc), selection: null, text: where.tocLabel ?? "", quote: "" }, "Bookmark");
  };
  const addHighlight = (sel: { cfi: string; text: string }) => {
    putAnnotation(crypto.randomUUID(), { kind: "highlight", anchor: anchorAt(cfiLoc(sel.cfi)), selection: { kind: "foliate-range", version: 1, cfi: sel.cfi }, text: "", quote: sel.text }, "Highlight");
    hostRef.current?.clearSelection();
    setSelection(null);
  };
  const submitNote = () => {
    if (!noteDraft || !noteDraft.text.trim()) return;
    if (noteDraft.id) {
      const a = live.find((x) => x.id === noteDraft.id)!;
      putAnnotation(a.id, { ...a.data!, text: noteDraft.text }, "Edit note");
    } else if (noteDraft.selection) {
      const s = noteDraft.selection;
      putAnnotation(crypto.randomUUID(), { kind: "note", anchor: anchorAt(cfiLoc(s.cfi)), selection: { kind: "foliate-range", version: 1, cfi: s.cfi }, text: noteDraft.text, quote: s.text }, "Note");
      hostRef.current?.clearSelection();
      setSelection(null);
    } else {
      const loc = hereLocator();
      if (loc) putAnnotation(crypto.randomUUID(), { kind: "note", anchor: anchorAt(loc), selection: null, text: noteDraft.text, quote: "" }, "Note");
    }
    setNoteDraft(null);
  };

  const painted: PaintedAnnotation[] = useMemo(
    () => live.filter((a) => current(a) && a.data!.selection?.kind === "foliate-range" && a.data!.kind !== "bookmark")
      .map((a) => ({ id: a.id, cfi: (a.data!.selection as { cfi: string }).cfi, kind: a.data!.kind as "highlight" | "note" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, e.file.contentVersion],
  );

  // ---- host lifecycle -----------------------------------------------------------------
  const onEvent = useCallback((m: ReaderEvent) => {
    switch (m.t) {
      case "loaded": setLoaded(true); break;
      case "toc": setToc(Array.isArray(m.items) ? (m.items as TocItem[]) : []); break;
      case "relocate": {
        const w: Where = {
          cfi: typeof m.cfi === "string" ? m.cfi : null, fraction: typeof m.fraction === "number" ? m.fraction : null,
          pageIndex: typeof m.pageIndex === "number" ? m.pageIndex : undefined, numPages: typeof m.numPages === "number" ? m.numPages : undefined,
          tocLabel: typeof m.tocLabel === "string" ? m.tocLabel : null,
        };
        setWhere(w);
        if (w.pageIndex !== undefined) saver.schedule({ kind: "pdf-page", version: 1, pageIndex: w.pageIndex, x: 0, y: 0 });
        else if (w.cfi) saver.schedule({ kind: "foliate-cfi", version: 1, cfi: w.cfi });
        break;
      }
      case "selection":
        setSelection(m.cleared || typeof m.cfi !== "string" ? null : { cfi: m.cfi, text: String(m.text ?? "") });
        break;
      case "annotation-click": {
        const a = live.find((x) => x.id === m.id);
        if (a) { setPanel(true); setNotice(null); }
        break;
      }
      case "key": hostRef.current?.nav(m.key === "ArrowLeft" || m.key === "PageUp" ? "prev" : "next"); break;
      case "restore-failed": setNotice("Your saved place could not be found in this book, so it opened at the start. Your saved position was not changed."); break;
      case "blocked-link": setNotice("An external link in the book was blocked."); break;
      case "error": setFailure(`The reader could not open this book (${String(m.code ?? "error")}).`); break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, saver.schedule]);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!kind || !box.current || e.file.sizeBytes === null || !e.file.contentPath) return;
    let host: ReaderHost | null = null;
    let cancelled = false;
    const saved = snapshot.position.position;
    const restore = saved && saved.anchor.contentVersion === e.file.contentVersion
      ? (saved.anchor.locator.kind === "foliate-cfi" ? { cfi: saved.anchor.locator.cfi } : saved.anchor.locator.kind === "pdf-page" ? { pageIndex: saved.anchor.locator.pageIndex } : {})
      : {};
    loadReaderOrigin().then((origin) => {
      if (cancelled || !box.current) return;
      host = new ReaderHost(box.current, remoteSource(e.file.contentPath!, e.file.sizeBytes!), (m) => onEventRef.current(m), origin);
      hostRef.current = host;
      return host.open({ kind, name: `book.${e.file.format}`, restore });
    }).catch((x) => setFailure((x as Error).message));
    return () => { cancelled = true; host?.dispose(); hostRef.current = null; setLoaded(false); };
    // The snapshot is fixed for the life of this mounted reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.file.contentVersion]);

  useEffect(() => { if (loaded) hostRef.current?.setStyle(style); }, [loaded, style]);
  useEffect(() => { if (loaded) hostRef.current?.setAnnotations(painted); }, [loaded, painted]);
  const changeStyle = (patch: Partial<ReaderStyle>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(next)); } catch { /* optional */ }
  };

  if (!kind) {
    return (
      <Stack p="md" maw={560}>
        <Alert color="yellow" title="This format cannot be opened in the browser yet">{e.file.format.toUpperCase()} files are listed but the web reader does not support them. You can still download the original file.</Alert>
        <Group><Button component={Link} to={`/editions/${e.id}`} variant="default">Back</Button>{e.file.contentPath && <Button component="a" href={e.file.contentPath} download>Download original</Button>}</Group>
      </Stack>
    );
  }

  const percent = where.fraction === null ? null : Math.round(where.fraction * 100);
  const sv = saver.status;
  const pend = usePendingState();
  const serverPos = saver.conflict?.server.position;
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <Group px="sm" py={6} justify="space-between" wrap="nowrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group gap="xs" wrap="nowrap">
          <Button component={Link} to={`/titles/${e.titleId}`} size="compact-sm" variant="default">Back</Button>
          <Button size="compact-sm" variant="default" onClick={() => setPanel(true)}>Contents &amp; notes</Button>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label="Previous page"><ActionIcon variant="default" aria-label="Previous page" onClick={() => hostRef.current?.nav("prev")}>‹</ActionIcon></Tooltip>
          <Tooltip label="Next page"><ActionIcon variant="default" aria-label="Next page" onClick={() => hostRef.current?.nav("next")}>›</ActionIcon></Tooltip>
          <Button size="compact-sm" variant="default" onClick={addBookmark} disabled={!loaded}>Bookmark</Button>
          <Button size="compact-sm" variant="default" onClick={() => setSettings(true)}>Aa</Button>
        </Group>
      </Group>

      {pend.offline && pend.items.length > 0 && (
        <Alert color="yellow" m="xs" role="status" data-testid="offline-banner">
          The server cannot be reached. {pend.items.length} change{pend.items.length === 1 ? " is" : "s are"} kept on this device{pend.durable ? "" : " (this browser cannot keep them across a reload)"} and will be sent when the connection returns. <Link to="/pending">Details</Link>
        </Alert>
      )}
      {failure && <Alert color="red" role="alert" m="xs">{failure}</Alert>}
      {notice && <Alert color="yellow" withCloseButton onClose={() => setNotice(null)} m="xs">{notice}</Alert>}
      {e.readiness !== "ready" && <Alert color="yellow" m="xs" title="Limited support">{e.issues.map((i) => i.detail).join(" ") || "This edition is only partly supported."}</Alert>}
      {sv === "changed" && <Alert color="orange" m="xs" role="alert" title="This book file changed" >A newer version of the file exists, so your position is no longer being saved. <Button size="compact-xs" onClick={() => location.reload()}>Reload</Button></Alert>}
      {sv === "conflict" && (
        <Alert color="orange" m="xs" role="alert" title="Your reading position changed elsewhere">
          <Group gap="xs">
            <Text size="sm">{serverPos ? `Saved from ${serverPos.deviceName || "another device"}.` : "A different place was saved."}</Text>
            {serverPos && <Button size="compact-xs" onClick={async () => { const loc = await saver.useServer(); if (loc?.kind === "foliate-cfi") hostRef.current?.goto({ cfi: loc.cfi }); else if (loc?.kind === "pdf-page") hostRef.current?.goto({ pageIndex: loc.pageIndex }); }}>Go to saved place</Button>}
            <Button size="compact-xs" variant="default" onClick={() => void saver.keepMine()}>Keep my place</Button>
          </Group>
        </Alert>
      )}

      <div ref={box} style={{ flex: 1, minHeight: 0, position: "relative" }} data-testid="reader-stage">
        {!loaded && !failure && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}><Busy /></div>}
      </div>

      {selection && (
        <Group p="xs" justify="center" gap="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }} data-testid="selection-bar">
          <Text size="sm" lineClamp={1} maw={260}>“{selection.text}”</Text>
          <Button size="compact-sm" onClick={() => addHighlight(selection)}>Highlight</Button>
          <Button size="compact-sm" variant="default" onClick={() => setNoteDraft({ text: "", selection })}>Add note</Button>
        </Group>
      )}
      <Group px="sm" py={4} justify="space-between" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Text size="xs" c="dimmed" lineClamp={1} maw="60%">{where.tocLabel ?? ""}</Text>
        <Group gap="xs">
          <Text size="xs" c="dimmed" data-testid="progress">{where.pageIndex !== undefined ? `Page ${where.pageIndex + 1} of ${where.numPages}` : percent !== null ? `${percent}%` : ""}</Text>
          <Badge size="xs" variant="light" color={sv === "saving" || sv === "offline" ? "gray" : "green"} data-testid="save-status">{sv === "saving" ? "saving" : sv === "offline" ? "waiting to send" : sv === "saved" ? "position saved" : sv === "conflict" ? "paused" : ""}</Badge>
        </Group>
      </Group>

      <Drawer opened={panel} onClose={() => setPanel(false)} title="Contents & notes" position="right" size="md">
        <Tabs defaultValue="toc">
          <Tabs.List><Tabs.Tab value="toc">Contents</Tabs.Tab><Tabs.Tab value="notes">Notes ({live.length})</Tabs.Tab></Tabs.List>
          <Tabs.Panel value="toc" pt="sm">
            {toc.length === 0 ? <Text c="dimmed" size="sm">This book has no table of contents.</Text> :
              <TocList items={toc} onPick={(href) => { hostRef.current?.goto({ href }); setPanel(false); }} />}
          </Tabs.Panel>
          <Tabs.Panel value="notes" pt="sm">
            <Stack gap="xs">
              <Button size="compact-sm" variant="default" onClick={() => setNoteDraft({ text: "", selection: null })} disabled={!hereLocator()}>Add note for this page</Button>
              {live.length === 0 && <Text c="dimmed" size="sm">No bookmarks, highlights or notes yet.</Text>}
              {live.map((a) => {
                const d = a.data!;
                const ok = current(a);
                return (
                  <Stack key={a.id} gap={2} p="xs" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 6 }} data-testid="annotation-item">
                    <Group justify="space-between"><Badge variant="light" color={d.kind === "highlight" ? "yellow" : d.kind === "note" ? "blue" : "gray"}>{d.kind}</Badge>
                      {!ok && <Badge color="orange" variant="outline">older file version</Badge>}
                      {a.unsaved === "pending" && <Badge color="gray" variant="outline" data-testid="unsaved">not saved yet</Badge>}
                      {a.unsaved === "attention" && <Badge color="red" variant="outline" component={Link} to="/pending">needs attention</Badge>}</Group>
                    {d.quote && <Text size="sm" lineClamp={3}>“{d.quote}”</Text>}
                    {d.text && <Text size="sm" fw={500}>{d.text}</Text>}
                    <Group gap="xs">
                      <Button size="compact-xs" variant="default" disabled={!ok}
                        onClick={() => { const l = d.anchor.locator; if (l.kind === "foliate-cfi") hostRef.current?.goto({ cfi: l.cfi }); else if (l.kind === "pdf-page") hostRef.current?.goto({ pageIndex: l.pageIndex }); setPanel(false); }}>Go to</Button>
                      {d.kind === "note" && ok && <Button size="compact-xs" variant="default" onClick={() => setNoteDraft({ id: a.id, text: d.text, selection: null })}>Edit</Button>}
                      <Button size="compact-xs" color="red" variant="subtle" onClick={() => removeAnnotation(a)}>Delete</Button>
                    </Group>
                  </Stack>
                );
              })}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Drawer>

      <Drawer opened={settings} onClose={() => setSettings(false)} title="Reading settings" position="bottom" size="auto">
        <Stack pb="md">
          <Text size="sm">Text size {style.fontPct}%</Text>
          <Slider min={70} max={220} step={10} value={style.fontPct} onChange={(v) => changeStyle({ fontPct: v })} aria-label="Text size" />
          <SegmentedControl value={style.theme} onChange={(v) => changeStyle({ theme: v as ReaderStyle["theme"] })} data={[{ value: "light", label: "Light" }, { value: "sepia", label: "Sepia" }, { value: "dark", label: "Dark" }]} />
          {kind !== "pdf" && <SegmentedControl value={style.flow} onChange={(v) => changeStyle({ flow: v as ReaderStyle["flow"] })} data={[{ value: "paginated", label: "Pages" }, { value: "scrolled", label: "Scroll" }]} />}
        </Stack>
      </Drawer>

      <Modal opened={!!noteDraft} onClose={() => setNoteDraft(null)} title={noteDraft?.id ? "Edit note" : "New note"}>
        <Stack>
          {noteDraft?.selection && <Text size="sm" c="dimmed" lineClamp={3}>“{noteDraft.selection.text}”</Text>}
          <Textarea label="Note" autosize minRows={3} maxLength={65536} data-autofocus value={noteDraft?.text ?? ""} onChange={(ev) => setNoteDraft((d) => d && { ...d, text: ev.currentTarget.value })} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setNoteDraft(null)}>Cancel</Button><Button onClick={submitNote} disabled={!noteDraft?.text.trim()}>Save note</Button></Group>
        </Stack>
      </Modal>
    </div>
  );
}
