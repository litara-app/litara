import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router";
import { get } from "../api/client";
import type { Annotation, AnnotationData, Locator, Page as Paged, ReaderSnapshot } from "../api/types";
import type { TimelineMark } from "../ui/feedback";
import { icons, notify, AnchoredPanel, ReadingTimeline, SelectField, BookmarkRibbon, Alert, Badge, Busy, Button, Card, DownloadLink, Drawer, ErrorBox, IconButton, Page, RangeSlider, Row, SegmentedField, Stack, Tabs, Text, TextAreaField, TextLink, Tip } from "../ui";
import { ComicReader } from "./ComicReader";
import { remoteSource } from "./fileSource";
import { FinishControl } from "./FinishControl";
import { profileMismatch } from "./profile";
import { loadReaderOrigin, ReaderHost, type PaintedAnnotation, type ReaderEvent, type ReaderFont, type ReaderKind, type ReaderStyle } from "./host";
import { useEditionPending, usePendingQueue, usePendingState } from "../pending/PendingProvider";
import { usePositionSaver } from "./usePositionSaver";
import { isBundledFont, loadFontFaces } from "./fonts";
import { useReadingSession } from "./useReadingSession";
import { QuietReveal, useQuietBar } from "./useQuietBar";

interface TocItem { label: string; href: string | null; items: TocItem[] }
interface Where { cfi: string | null; fraction: number | null; pageIndex?: number; x?: number; y?: number; numPages?: number; tocLabel: string | null }

const KINDS: Record<string, ReaderKind> = { epub: "epub", kepub: "epub", fb2: "fb2", pdf: "pdf", cbz: "cbz", mobi: "mobi", azw: "mobi", azw3: "mobi" };
const STYLE_KEY = "litara.reader.style";
const DEFAULT_STYLE: ReaderStyle = { fontPct: 100, theme: "light", flow: "paginated" };

function loadStyle(): ReaderStyle {
  try {
    const s = JSON.parse(localStorage.getItem(STYLE_KEY) ?? "null");
    if (s && typeof s === "object") return { ...DEFAULT_STYLE, ...s };
  } catch { /* storage unavailable: defaults */ }
  return DEFAULT_STYLE;
}

const THEME_ITEMS = [{ value: "light", label: "Light" }, { value: "sepia", label: "Sepia" }, { value: "dark", label: "Dark" }];
const FONT_ITEMS = [{ value: "publisher", label: "The book's own" }, { value: "literata", label: "Literata (serif)" }, { value: "atkinson", label: "Atkinson Hyperlegible (sans)" }, { value: "dyslexic", label: "OpenDyslexic" }, { value: "serif", label: "System serif" }, { value: "sans", label: "System sans" }, { value: "mono", label: "Monospace" }];
const FLOW_ITEMS = [{ value: "paginated", label: "Pages" }, { value: "scrolled", label: "Scroll" }];

function TocList({ items, onPick }: { items: TocItem[]; onPick: (href: string) => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <ul className="lt-toc">
      {items.map((i, n) => (
        <li key={`${n}-${i.label}`}>
          <Row gap="xs">
            {i.items.length > 0 && <IconButton variant="subtle" aria-label={`${open[n] ? "Collapse" : "Expand"} ${i.label || "(untitled)"}`} aria-expanded={!!open[n]} onClick={() => setOpen({ ...open, [n]: !open[n] })}>{open[n] ? "▾" : "▸"}</IconButton>}
            <Button variant="subtle" disabled={!i.href} onClick={() => i.href && onPick(i.href)}>{i.label || "(untitled)"}</Button>
          </Row>
          {i.items.length > 0 && open[n] && <TocList items={i.items} onPick={onPick} />}
        </li>
      ))}
    </ul>
  );
}

export function ReaderPage() {
  const { editionId = "" } = useParams();
  const snapshot = useQuery({ queryKey: ["reader", editionId], queryFn: () => get<ReaderSnapshot>(`/editions/${editionId}/reader`), staleTime: Infinity, gcTime: 0 });
  if (snapshot.isPending) return <Busy />;
  if (snapshot.error) return <Page><ErrorBox error={snapshot.error} /><Row><Button to="/" icon={icons.arrowLeft}>Back to library</Button></Row></Page>;
  const edition = snapshot.data.edition;
  const damage = edition.capabilities.read.issues.find((i) => i.code === "file_damaged");
  if (damage) {
    return <Page>
      <Alert tone="warning" title="Damaged file">{damage.detail}</Alert>
      <Row>
        <Button to={`/editions/${edition.id}`} icon={icons.arrowLeft}>Back to edition</Button>
        {edition.file.contentPath && <DownloadLink href={edition.file.contentPath}>Download original</DownloadLink>}
      </Row>
    </Page>;
  }
  if (["cbz", "cbr", "cb7"].includes(snapshot.data.edition.file.format)) return <ComicReader snapshot={snapshot.data} />;
  return <Reader snapshot={snapshot.data} />;
}

function Reader({ snapshot }: { snapshot: ReaderSnapshot }) {
  const e = snapshot.edition;
  // The server expects a different engine profile than this build bundles: locators cannot be trusted either way.
  const mismatch = profileMismatch(snapshot.engine, snapshot.engineProfile);
  const kind = KINDS[e.file.format];
  const box = useRef<HTMLDivElement>(null);
  const hostRef = useRef<ReaderHost | null>(null);
  const qc = useQueryClient();
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [where, setWhere] = useState<Where>({ cfi: null, fraction: null, tocLabel: null });
  type Sel = { cfi: string; text: string; rect?: { x: number; y: number; width: number; height: number }; pdf?: { pageIndex: number; rectangles: { x: number; y: number; width: number; height: number }[] } };
  const [selection, setSelection] = useState<Sel | null>(null);
  const [areaMode, setAreaMode] = useState(false);
  const [style, setStyle] = useState<ReaderStyle>(loadStyle);
  const [panel, setPanel] = useState(false);
  const [settings, setSettings] = useState(false);
  const [noteDraft, setNoteDraft] = useState<{ id?: string; text: string; selection: Sel | null } | null>(null);
  const quiet = useQuietBar(panel || settings || !!noteDraft);
  const { toolbar, changeToolbar, barOn, reveal: revealBar } = quiet;
  const [chapters, setChapters] = useState<{ label: string; fraction: number }[]>([]);
  const [located, setLocated] = useState<Record<string, number>>({});
  const saver = usePositionSaver({ editionId: e.id, fileId: e.file.id, contentVersion: e.file.contentVersion, initialRevision: snapshot.position.revision });

  // ---- annotations ----------------------------------------------------------
  const annKey = useMemo(() => ["annotations", e.id], [e.id]);
  const annotations = useQuery({ queryKey: annKey, queryFn: () => get<Paged<Annotation>>(`/editions/${e.id}/annotations?includeDeleted=false&size=200`) });
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
    if (mismatch) return null;
    if (kind === "pdf") return where.pageIndex === undefined ? null : { kind: "pdf-page", version: 1, pageIndex: where.pageIndex, x: where.x ?? 0, y: where.y ?? 0 };
    return where.cfi ? cfiLoc(where.cfi) : null;
  };
  // The bookmark here, if there is one: the same page of a PDF, or the same place in an ebook.
  const bookmarkHere = live.find((x) => {
    const d = x.data!;
    if (d.kind !== "bookmark" || !current(x)) return false;
    const l = d.anchor.locator;
    return l.kind === "pdf-page" ? where.pageIndex === l.pageIndex : l.kind === "foliate-cfi" ? where.cfi === l.cfi : false;
  });
  // The ribbon fills when a bookmark is set and empties when it is removed; a toast says which, and where.
  const toggleBookmark = () => {
    if (bookmarkHere) {
      removeAnnotation(bookmarkHere);
      notify.info("Bookmark removed");
      return;
    }
    const loc = hereLocator();
    if (!loc) return;
    putAnnotation(crypto.randomUUID(), { kind: "bookmark", anchor: anchorAt(loc), selection: null, text: where.tocLabel ?? "", quote: "" }, "Bookmark");
    notify.success("Bookmark added", { detail: where.pageIndex !== undefined ? `Page ${where.pageIndex + 1}` : where.tocLabel || undefined });
  };
  const selData = (s: Sel): { anchor: ReturnType<typeof anchorAt>; selection: AnnotationData["selection"] } => s.pdf
    ? { anchor: anchorAt({ kind: "pdf-page", version: 1, pageIndex: s.pdf.pageIndex, x: s.pdf.rectangles[0].x, y: s.pdf.rectangles[0].y }), selection: { kind: "pdf-rectangles", version: 1, pageIndex: s.pdf.pageIndex, rectangles: s.pdf.rectangles } }
    : { anchor: anchorAt(cfiLoc(s.cfi)), selection: { kind: "foliate-range", version: 1, cfi: s.cfi } };
  const addHighlight = (sel: Sel) => {
    putAnnotation(crypto.randomUUID(), { kind: "highlight", ...selData(sel), text: "", quote: sel.text }, "Highlight");
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
      putAnnotation(crypto.randomUUID(), { kind: "note", ...selData(s), text: noteDraft.text, quote: s.text }, "Note");
      hostRef.current?.clearSelection();
      setSelection(null);
    } else {
      const loc = hereLocator();
      if (loc) putAnnotation(crypto.randomUUID(), { kind: "note", anchor: anchorAt(loc), selection: null, text: noteDraft.text, quote: "" }, "Note");
    }
    setNoteDraft(null);
  };

  const painted: PaintedAnnotation[] = useMemo(
    () => mismatch ? [] : live.filter((a) => current(a) && a.data!.kind !== "bookmark" && (a.data!.selection?.kind === "foliate-range" || a.data!.selection?.kind === "pdf-rectangles"))
      .map((a): PaintedAnnotation => {
        const s = a.data!.selection!;
        const k = a.data!.kind as "highlight" | "note";
        return s.kind === "pdf-rectangles" ? { id: a.id, pdf: { pageIndex: s.pageIndex, rectangles: s.rectangles }, kind: k } : { id: a.id, cfi: (s as { cfi: string }).cfi, kind: k };
      }),
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
          pageIndex: typeof m.pageIndex === "number" ? m.pageIndex : undefined, x: typeof m.x === "number" ? m.x : undefined, y: typeof m.y === "number" ? m.y : undefined, numPages: typeof m.numPages === "number" ? m.numPages : undefined,
          tocLabel: typeof m.tocLabel === "string" ? m.tocLabel : null,
        };
        setWhere(w);
        if (mismatch) { /* never save a location another engine version cannot interpret */ }
        else if (w.pageIndex !== undefined) saver.schedule({ kind: "pdf-page", version: 1, pageIndex: w.pageIndex, x: w.x ?? 0, y: w.y ?? 0 });
        else if (w.cfi) saver.schedule({ kind: "foliate-cfi", version: 1, cfi: w.cfi });
        break;
      }
      case "selection": {
        const r = m.rect as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | undefined;
        const rect = r && [r.x, r.y, r.width, r.height].every((v) => typeof v === "number" && Number.isFinite(v)) ? (r as Sel["rect"]) : undefined;
        setSelection(m.cleared || mismatch ? null : typeof m.cfi === "string" ? { cfi: m.cfi, text: String(m.text ?? ""), rect }
          : m.pdf ? { cfi: "", text: typeof m.text === "string" ? m.text : "", pdf: m.pdf as Sel["pdf"], rect } : null);
        break;
      }
      case "chapters":
        setChapters(Array.isArray(m.items) ? (m.items as { label: string; fraction: number }[]).filter((c) => typeof c.fraction === "number") : []);
        break;
      case "located":
        setLocated(m.positions && typeof m.positions === "object" ? (m.positions as Record<string, number>) : {});
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
    const restore = !mismatch && saved && saved.anchor.contentVersion === e.file.contentVersion
      ? (saved.anchor.locator.kind === "foliate-cfi" ? { cfi: saved.anchor.locator.cfi } : saved.anchor.locator.kind === "pdf-page" ? { pageIndex: saved.anchor.locator.pageIndex, x: saved.anchor.locator.x, y: saved.anchor.locator.y } : {})
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
  // A bundled font is fetched the first time it is picked, then handed to the reader frame.
  const sentFonts = useRef(new Set<string>());
  useEffect(() => {
    const f = style.font;
    if (!loaded || !isBundledFont(f) || sentFonts.current.has(f)) return;
    sentFonts.current.add(f);
    loadFontFaces(f).then((faces) => hostRef.current?.setFonts(f, faces)).catch(() => { sentFonts.current.delete(f); setNotice("That font could not be loaded, so the book's own font is shown."); });
  }, [loaded, style.font]);
  useEffect(() => { if (loaded) hostRef.current?.setAnnotations(painted); }, [loaded, painted]);
  useEffect(() => {
    if (!loaded || kind === "pdf") return;
    const items = live.flatMap((a) => (a.data!.anchor.locator.kind === "foliate-cfi" && current(a) ? [{ id: a.id, cfi: (a.data!.anchor.locator as { cfi: string }).cfi }] : []));
    hostRef.current?.locate(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, live]);
  const changeStyle = (patch: Partial<ReaderStyle>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(next)); } catch { /* optional */ }
  };

  if (!kind) {
    return (
      <Page>
        <Alert tone="warning" title="This format cannot be opened in the browser yet">{e.file.format.toUpperCase()} files are listed but the web reader does not support them. You can still download the original file.</Alert>
        <Row><Button to={`/editions/${e.id}`} icon={icons.arrowLeft}>Back</Button>{e.file.contentPath && <DownloadLink href={e.file.contentPath}>Download original</DownloadLink>}</Row>
      </Page>
    );
  }

  const gotoAnnotation = (a: Annotation) => {
    const l = a.data!.anchor.locator;
    if (l.kind === "foliate-cfi") hostRef.current?.goto({ cfi: l.cfi });
    else if (l.kind === "pdf-page") hostRef.current?.goto({ pageIndex: l.pageIndex, x: l.x, y: l.y });
  };
  const marks: TimelineMark[] = [
    ...chapters.map((c, n) => ({ id: `c${n}`, at: c.fraction, kind: "chapter" as const, label: c.label || "Chapter", onPick: () => hostRef.current?.goto({ fraction: c.fraction + 1e-6 }) })),
    ...live.flatMap((a): TimelineMark[] => {
      const d = a.data!;
      const l = d.anchor.locator;
      const at = l.kind === "pdf-page" ? (where.numPages && where.numPages > 1 ? l.pageIndex / (where.numPages - 1) : undefined) : located[a.id];
      if (at === undefined || !current(a)) return [];
      const kindLabel = d.kind === "bookmark" ? "Bookmark" : d.kind === "note" ? "Note" : "Highlight";
      return [{ id: a.id, at, kind: d.kind, label: `${kindLabel}${d.text ? `: ${d.text}` : d.quote ? `: ${d.quote}` : ""}`.slice(0, 120), onPick: () => gotoAnnotation(a) }];
    }),
  ];
  useReadingSession(e.id, where.fraction, loaded && !mismatch);
  const percent = where.fraction === null ? null : Math.round(where.fraction * 100);
  const sv = saver.status;
  const pend = usePendingState();
  const serverPos = saver.conflict?.server.position;
  return (
    <div className="lt-reader" data-toolbar={toolbar} data-bar={barOn ? "on" : "off"}>
      <h1 className="lt-sr">Reading {e.label || e.file.format.toUpperCase()}</h1>
      <header className="lt-reader-bar" {...quiet.barProps}>
        <Row>
          <Button size="sm" to={`/titles/${e.titleId}`} icon={icons.arrowLeft}>Back</Button>
          <Button size="sm" onClick={() => setPanel(true)} icon={icons.list}>Contents &amp; notes</Button>
        </Row>
        <span className="lt-reader-title"><Text as="span" size="sm" clamp={1}>{e.label || ""}</Text></span>
        <Row>
          <Tip label="Previous page"><IconButton aria-label="Previous page" onClick={() => hostRef.current?.nav("prev")}>‹</IconButton></Tip>
          <Tip label="Next page"><IconButton aria-label="Next page" onClick={() => hostRef.current?.nav("next")}>›</IconButton></Tip>
          {kind === "pdf" && <Button size="sm" variant={areaMode ? "primary" : "default"} aria-pressed={areaMode} data-testid="area-tool" disabled={!loaded || mismatch} onClick={() => { const n = !areaMode; setAreaMode(n); hostRef.current?.setPdfMode(n ? "area" : "off"); }} icon={icons.highlight}>Highlight area</Button>}
          <AnchoredPanel open={settings} onOpenChange={setSettings} label="Text settings" icon={icons.textSize} text="Aa">
            <Stack>
              <Text size="sm">Text size {style.fontPct}%</Text>
              <RangeSlider label="Text size" min={70} max={220} step={10} value={style.fontPct} onChange={(v) => changeStyle({ fontPct: v })} />
              <SegmentedField label="Theme" value={style.theme} onValue={(v) => changeStyle({ theme: v as ReaderStyle["theme"] })} items={THEME_ITEMS} />
              {kind !== "pdf" && <SelectField label="Font" value={style.font ?? "publisher"} onValue={(v) => changeStyle({ font: (v || "publisher") as ReaderFont })} items={FONT_ITEMS} />}
              {kind !== "pdf" && <SegmentedField label="Layout" value={style.flow} onValue={(v) => changeStyle({ flow: v as ReaderStyle["flow"] })} items={FLOW_ITEMS} />}
              <SegmentedField label="Toolbar" value={toolbar} onValue={(v) => changeToolbar(v === "always" ? "always" : "auto")} items={[{ value: "auto", label: "Auto-hide" }, { value: "always", label: "Always show" }]} />
            </Stack>
          </AnchoredPanel>
        </Row>
      </header>

      <div className="lt-reader-banners">
        {pend.offline && pend.items.length > 0 && (
          <Alert tone="warning" role="status" data-testid="offline-banner">
            The server cannot be reached. {pend.items.length} change{pend.items.length === 1 ? " is" : "s are"} kept on this device{pend.durable ? "" : " (this browser cannot keep them across a reload)"} and will be sent when the connection returns. <TextLink to="/pending">Details</TextLink>
          </Alert>
        )}
        {failure && <Alert tone="danger" role="alert">{failure}</Alert>}
        {notice && <Alert tone="warning" onClose={() => setNotice(null)}>{notice}</Alert>}
        {mismatch && <Alert tone="warning" role="alert" title="Reader version mismatch" data-testid="profile-mismatch">The server expects a different reader engine version ({snapshot.engineProfile}) than this page uses. To avoid saving or restoring a wrong place, your saved position and highlights are not applied and nothing new is saved from here. Reload to get the matching version.</Alert>}
        {e.readiness !== "ready" && <Alert tone="warning" title="Limited support">{e.issues.map((i) => i.detail).join(" ") || "This edition is only partly supported."}</Alert>}
        {sv === "changed" && <Alert tone="warning" role="alert" title="This book file changed">A newer version of the file exists, so your position is no longer being saved. <Button size="sm" onClick={() => location.reload()} icon={icons.reset}>Reload</Button></Alert>}
        {sv === "conflict" && (
          <Alert tone="warning" role="alert" title="Your reading position changed elsewhere">
            <Row>
              <Text as="span" size="sm">{serverPos ? `Saved from ${serverPos.deviceName || "another device"}.` : "A different place was saved."}</Text>
              {serverPos && <Button size="sm" variant="primary" onClick={async () => { const loc = await saver.useServer(); if (loc?.kind === "foliate-cfi") hostRef.current?.goto({ cfi: loc.cfi }); else if (loc?.kind === "pdf-page") hostRef.current?.goto({ pageIndex: loc.pageIndex, x: loc.x, y: loc.y }); }} icon={icons.chevRight}>Go to saved place</Button>}
              <Button size="sm" onClick={() => void saver.keepMine()} icon={icons.check}>Keep my place</Button>
            </Row>
            {saver.resolveError && <Text size="sm" tone="danger" data-testid="resolve-error">Not changed: {saver.resolveError} Both places are still kept.</Text>}
          </Alert>
        )}
      </div>

      <div ref={box} className="lt-reader-stage" data-testid="reader-stage">
        {!loaded && !failure && <div className="lt-reader-busy"><Busy /></div>}
        <QuietReveal barOn={barOn} reveal={revealBar} />
        {selection && (() => {
          const r = selection.rect;
          const width = box.current?.clientWidth ?? 800;
          const x = r ? Math.min(width - 130, Math.max(130, r.x + r.width / 2)) : 0;
          const below = !!r && r.y < 70;
          const y = r ? (below ? r.y + r.height + 10 : r.y - 10) : 0;
          const at = { "--x": `${x}px`, "--y": `${y}px` } as CSSProperties;
          return (
            <div className="lt-selpop" data-testid="selection-bar" data-below={below || undefined} data-fallback={r ? undefined : true} style={at}>
              <Button size="sm" variant="primary" onClick={() => addHighlight(selection)} icon={icons.highlight}>Highlight</Button>
              <Button size="sm" onClick={() => setNoteDraft({ text: "", selection })} icon={icons.pencil}>Add note</Button>
            </div>
          );
        })()}
        <BookmarkRibbon on={!!bookmarkHere} label={bookmarkHere ? "Remove bookmark" : "Bookmark"} disabled={!loaded || mismatch} onToggle={toggleBookmark} />
      </div>

      <footer className="lt-reader-foot">
        <span className="lt-reader-chapter"><Text as="span" size="xs" tone="dim" clamp={1}>{where.tocLabel ?? ""}</Text></span>
        <div className="lt-reader-track"><ReadingTimeline value={percent ?? 0} label="Progress through the book" marks={marks} /></div>
        <Row gap="xs">
          <Text as="span" size="xs" tone="dim" data-testid="progress">{where.pageIndex !== undefined ? `Page ${where.pageIndex + 1} of ${where.numPages}` : percent !== null ? `${percent}%` : ""}</Text>
          <Badge tone={sv === "saving" || sv === "offline" ? "neutral" : "success"} data-testid="save-status">{sv === "saving" ? "saving" : sv === "offline" ? "waiting to send" : sv === "saved" ? "position saved" : sv === "conflict" ? "paused" : ""}</Badge>
        </Row>
      </footer>

      <Drawer open={panel} onClose={() => setPanel(false)} title="Contents & notes" side="left">
        <FinishControl edition={e} />
        <Tabs label="Contents and notes" tabs={[
          { value: "toc", label: "Contents", content: toc.length === 0 ? <Text tone="dim" size="sm">This book has no table of contents.</Text> :
            <TocList items={toc} onPick={(href) => { hostRef.current?.goto({ href }); setPanel(false); }} /> },
          { value: "notes", label: `Notes (${live.length})`, content: (
            <Stack gap="sm">
              <Button size="sm" onClick={() => setNoteDraft({ text: "", selection: null })} disabled={!hereLocator()} icon={icons.pencil}>Add note for this page</Button>
              {live.length === 0 && <Text tone="dim" size="sm">No bookmarks, highlights or notes yet.</Text>}
              {live.map((a) => {
                const d = a.data!;
                const ok = current(a);
                return (
                  <Card key={a.id} pad="sm" data-testid="annotation-item">
                    <Stack gap="xs">
                      <Row justify="between">
                        <Badge tone={d.kind === "highlight" ? "warning" : d.kind === "note" ? "info" : "neutral"}>{d.kind}</Badge>
                        {!ok && <Badge outline tone="warning">older file version</Badge>}
                        {a.unsaved === "pending" && <Badge outline tone="neutral" data-testid="unsaved">not saved yet</Badge>}
                        {a.unsaved === "attention" && <TextLink to="/pending"><Badge outline tone="danger">needs attention</Badge></TextLink>}
                      </Row>
                      {d.quote && <Text size="sm" clamp={3}>“{d.quote}”</Text>}
                      {d.text && <Text size="sm" strong>{d.text}</Text>}
                      <Row>
                        <Button size="sm" disabled={!ok} icon={icons.chevRight}
                          onClick={() => { const l = d.anchor.locator; if (l.kind === "foliate-cfi") hostRef.current?.goto({ cfi: l.cfi }); else if (l.kind === "pdf-page") hostRef.current?.goto({ pageIndex: l.pageIndex, x: l.x, y: l.y }); setPanel(false); }}>Go to</Button>
                        {d.kind === "note" && ok && <Button size="sm" onClick={() => setNoteDraft({ id: a.id, text: d.text, selection: null })} icon={icons.pencil}>Edit</Button>}
                        <Button size="sm" variant="danger" onClick={() => removeAnnotation(a)} icon={icons.trash}>Delete</Button>
                      </Row>
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          ) },
        ]} />
      </Drawer>

      <Drawer open={!!noteDraft} onClose={() => setNoteDraft(null)} title={noteDraft?.id ? "Edit note" : "New note"}
        actions={<><Button onClick={() => setNoteDraft(null)} icon={icons.close}>Cancel</Button><Button variant="primary" onClick={submitNote} disabled={!noteDraft?.text.trim()} icon={icons.save}>Save note</Button></>}>
        <Stack>
          {noteDraft?.selection && <Text size="sm" tone="dim" clamp={3}>{noteDraft.selection.text ? `“${noteDraft.selection.text}”` : "Selected area"}</Text>}
          <TextAreaField label="Note" rows={4} maxLength={65536} autoFocus value={noteDraft?.text ?? ""} onValue={(v) => setNoteDraft((d) => d && { ...d, text: v })} />
        </Stack>
      </Drawer>
    </div>
  );
}
