import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, assertSameSession, get, sessionEpoch } from "../api/client";
import type { Annotation, AnnotationData, Edition, Locator, Page as Paged, ReaderSnapshot } from "../api/types";
import { useEditionPending, usePendingQueue, usePendingState } from "../pending/PendingProvider";
import { icons, notify, AnchoredPanel, Alert, Badge, BookmarkRibbon, Busy, Button, Card, DownloadLink, Drawer, IconButton, Page, ReadingTimeline, Row, SegmentedField, Stack, Text, TextAreaField, TextLink } from "../ui";
import type { TimelineMark } from "../ui/feedback";
import { QuietReveal, useQuietBar } from "./useQuietBar";
import { usePositionSaver } from "./usePositionSaver";

interface ComicPage { index: number; entryId: string; mimeType: string; width: number; height: number; contentPath: string }
interface Manifest {
  fileId: string; contentVersion: string; manifestVersion: string; state: "processing" | "ready" | "incomplete" | "unsupported";
  pages: ComicPage[]; issues: { code: string; detail: string }[];
}

interface Style { fit: "width" | "height" | "original"; dir: "ltr" | "rtl"; dark: boolean }
const STYLE_KEY = "litara.comic.style";
const DEFAULT: Style = { fit: "height", dir: "ltr", dark: true };
function loadStyle(): Style {
  try { const s = JSON.parse(localStorage.getItem(STYLE_KEY) ?? "null"); if (s && typeof s === "object") return { ...DEFAULT, ...s }; } catch { /* defaults */ }
  return DEFAULT;
}

/** Cookie-authenticated page fetch; blobs let pages be preloaded despite the no-store cache policy. */
async function fetchPage(path: string): Promise<string> {
  const since = sessionEpoch();
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  assertSameSession(since);
  if (!res.ok) {
    let problem: Record<string, unknown> = {};
    try { problem = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(res.status, problem);
  }
  const blob = await res.blob();
  assertSameSession(since);
  return URL.createObjectURL(blob);
}

function useManifest(e: Edition) {
  const path = `/files/${e.file.id}/versions/${e.file.contentVersion}/pages`;
  const prepare = () => api<Manifest>("POST", path, { operationId: crypto.randomUUID(), baseRevision: "0", contentVersion: e.file.contentVersion });
  const q = useQuery({
    queryKey: ["comic-manifest", e.file.id, e.file.contentVersion],
    queryFn: async () => {
      try { return await get<Manifest>(path); }
      catch (x) { if (x instanceof ApiError && x.status === 404 && x.code === "pages_not_prepared") return prepare(); throw x; }
    },
    refetchInterval: (query) => (query.state.data?.state === "processing" ? 1500 : false),
    retry: false, gcTime: 0,
  });
  return { ...q, retryPrepare: async () => { await prepare(); await q.refetch(); } };
}

export function ComicReader({ snapshot }: { snapshot: ReaderSnapshot }) {
  const e = snapshot.edition;
  const manifest = useManifest(e);
  if (manifest.isPending) return <Busy />;
  if (manifest.error) {
    return <Page><Alert tone="danger" title="The pages could not be requested">{(manifest.error as Error).message}</Alert><Row><Button to={`/editions/${e.id}`} icon={icons.arrowLeft}>Back</Button></Row></Page>;
  }
  const m = manifest.data;
  const back = <Button size="sm" to={`/titles/${e.titleId}`} icon={icons.arrowLeft}>Back</Button>;
  const download = e.file.contentPath && <DownloadLink href={e.file.contentPath}>Download original</DownloadLink>;
  if (m.state === "processing") {
    return <Page><div data-testid="comic-processing"><Busy /><Text>Preparing the pages. This happens once per file version.</Text><Row justify="center">{back}</Row></div></Page>;
  }
  if (m.state === "unsupported") {
    return (
      <Page>
        <div data-testid="comic-unsupported">
          <Alert tone="warning" title="These pages cannot be shown in the browser">
            {m.issues.map((i) => i.detail).join(" ") || "This archive cannot be read as comic pages."}{" "}
            Your original file is untouched{e.file.format !== "cbz" ? ` (${e.file.format.toUpperCase()} extraction is not available yet)` : ""}.
          </Alert>
          <Row>{back}{download}</Row>
        </div>
      </Page>
    );
  }
  if (m.state === "incomplete") {
    return (
      <Page>
        <Alert tone="warning" title="The pages are not ready">{m.issues.map((i) => i.detail).join(" ") || "Extraction did not finish."}</Alert>
        <Row>{back}<Button size="sm" onClick={() => void manifest.retryPrepare()} icon={icons.reset}>Try again</Button></Row>
      </Page>
    );
  }
  return <Pages snapshot={snapshot} manifest={m} />;
}


function Pages({ snapshot, manifest: m }: { snapshot: ReaderSnapshot; manifest: Manifest }) {
  const e = snapshot.edition;
  const qc = useQueryClient();
  const queue = usePendingQueue();
  const pend = usePendingState();
  const saver = usePositionSaver({ editionId: e.id, fileId: e.file.id, contentVersion: e.file.contentVersion, initialRevision: snapshot.position.revision });
  const [style, setStyle] = useState<Style>(loadStyle);
  const [panel, setPanel] = useState(false);
  const [settings, setSettings] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const n = m.pages.length;
  const quiet = useQuietBar(panel || settings || noteDraft !== null);

  // Resume by page identity (entry ID), never by a bare index: a re-extracted archive keeps its entry IDs.
  const start = useMemo(() => {
    const loc = snapshot.position.position?.anchor.locator;
    if (loc?.kind !== "comic-page") return 0;
    const i = m.pages.findIndex((p) => p.entryId === loc.entryId);
    if (i >= 0) return i;
    return -1;
  }, [snapshot.position.position, m.pages]);
  const [index, setIndex] = useState(Math.max(0, start));
  useEffect(() => { if (start < 0) setNotice("Your saved page was not found in this archive, so it opened at the first page. Your saved position was not changed."); }, [start]);

  const locatorFor = useCallback((i: number): Locator => ({ kind: "comic-page", version: 1, pageIndex: i, entryId: m.pages[i].entryId, manifestVersion: m.manifestVersion }), [m]);
  const go = useCallback((i: number) => {
    const next = Math.min(n - 1, Math.max(0, i));
    setIndex(next);
    saver.schedule(locatorFor(next));
  }, [n, saver, locatorFor]);

  // Page images: the current page and its neighbours, fetched with the session cookie.
  const [urls, setUrls] = useState<Record<number, string | Error>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  useEffect(() => {
    const want = new Set([index, index + 1, index + 2, index - 1].filter((i) => i >= 0 && i < n));
    for (const i of want) {
      if (urlsRef.current[i] !== undefined) continue;
      setUrls((u) => (u[i] !== undefined ? u : { ...u, [i]: "" }));
      fetchPage(m.pages[i].contentPath).then(
        (u) => setUrls((x) => ({ ...x, [i]: u })),
        (err: Error) => setUrls((x) => ({ ...x, [i]: err })),
      );
    }
    setUrls((u) => {
      const next: Record<number, string | Error> = {};
      for (const [k, v] of Object.entries(u)) {
        if (want.has(Number(k))) next[Number(k)] = v;
        else if (typeof v === "string" && v) URL.revokeObjectURL(v);
      }
      return next;
    });
  }, [index, n, m.pages]);
  useEffect(() => () => { for (const v of Object.values(urlsRef.current)) if (typeof v === "string" && v) URL.revokeObjectURL(v); }, []);

  const step = (d: number) => go(index + (style.dir === "rtl" ? -d : d));
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.closest("input,textarea,[role=slider]")) return;
      if (ev.key === "ArrowRight") step(1);
      if (ev.key === "ArrowLeft") step(-1);
      if (ev.key === "PageDown" || ev.key === " ") { ev.preventDefault(); go(index + 1); }
      if (ev.key === "PageUp") go(index - 1);
      if (ev.key === "Home") go(0);
      if (ev.key === "End") go(n - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const changeStyle = (patch: Partial<Style>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(next)); } catch { /* optional */ }
  };

  // ---- bookmarks and page notes (text highlights do not exist for image pages) --------------
  const annKey = ["annotations", e.id];
  const annotations = useQuery({ queryKey: annKey, queryFn: () => get<Paged<Annotation>>(`/editions/${e.id}/annotations?includeDeleted=false&size=200`) });
  const pendingOps = useEditionPending(e.id).filter((o) => o.kind === "annotation");
  type View = Annotation & { unsaved?: boolean };
  const items: View[] = useMemo(() => {
    const byId = new Map<string, View>((annotations.data?.items ?? []).map((a) => [a.id, a]));
    for (const o of pendingOps) {
      const id = o.resourceKey.slice("annotation:".length);
      if (o.method === "DELETE") { const cur = byId.get(id); if (cur) byId.set(id, { ...cur, deleted: true, data: null }); continue; }
      byId.set(id, { id, editionId: e.id, revision: byId.get(id)?.revision ?? "0", deleted: false, data: (o.body as { data: AnnotationData }).data, updatedAt: "", unsaved: true });
    }
    return [...byId.values()].filter((a) => !a.deleted && a.data);
  }, [annotations.data, pendingOps, e.id]);
  useEffect(() => queue.onSent((o) => { if (o.kind === "annotation") void qc.invalidateQueries({ queryKey: annKey }); }), [queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const revisionOf = (id: string) => Number(annotations.data?.items.find((x) => x.id === id)?.revision ?? "0");
  const put = (id: string, data: AnnotationData, label: string) => {
    const opId = crypto.randomUUID();
    void queue.enqueue({ id: opId, kind: "annotation", resourceKey: `annotation:${id}`, editionId: e.id, method: "PUT", path: `/editions/${e.id}/annotations/${id}`, label,
      confirmedRevision: revisionOf(id), body: (base) => ({ operationId: opId, baseRevision: base, capturedAt: new Date().toISOString(), data }) });
  };
  const del = (a: Annotation) => {
    const opId = crypto.randomUUID();
    void queue.enqueue({ id: opId, kind: "annotation", resourceKey: `annotation:${a.id}`, editionId: e.id, method: "DELETE", path: `/editions/${e.id}/annotations/${a.id}`, label: "Delete annotation",
      confirmedRevision: revisionOf(a.id), body: (base) => ({ operationId: opId, baseRevision: base, capturedAt: new Date().toISOString() }) });
  };
  const anchor = () => ({ fileId: e.file.id, contentVersion: e.file.contentVersion, locator: locatorFor(index) });
  const pageOf = (a: Annotation) => { const l = a.data!.anchor.locator; return l.kind === "comic-page" ? m.pages.findIndex((p) => p.entryId === l.entryId) : -1; };

  const bookmarkHere = items.find((a) => a.data!.kind === "bookmark" && pageOf(a) === index);
  const toggleBookmark = () => {
    if (bookmarkHere) { del(bookmarkHere); notify.info("Bookmark removed"); return; }
    put(crypto.randomUUID(), { kind: "bookmark", anchor: anchor(), selection: null, text: `Page ${index + 1}`, quote: "" }, "Bookmark");
    notify.success("Bookmark added", { detail: `Page ${index + 1}` });
  };
  const marks: TimelineMark[] = items.flatMap((a): TimelineMark[] => {
    const pi = pageOf(a);
    if (pi < 0) return [];
    const kind = a.data!.kind === "note" ? "note" : "bookmark";
    return [{ id: a.id, at: n > 1 ? pi / (n - 1) : 0, kind, label: `${kind === "note" ? "Note" : "Bookmark"} on page ${pi + 1}${a.data!.kind === "note" && a.data!.text ? `: ${a.data!.text}` : ""}`.slice(0, 120), onPick: () => go(pi) }];
  });

  const current = urls[index];
  const sv = saver.status;
  const serverPos = saver.conflict?.server.position;

  return (
    <div className="lt-reader" data-dark={style.dark || undefined} data-toolbar={quiet.toolbar} data-bar={quiet.barOn ? "on" : "off"}>
      <h1 className="lt-sr">Reading {e.label || e.file.format.toUpperCase()}</h1>
      <header className="lt-reader-bar" {...quiet.barProps}>
        <Row>
          <Button size="sm" to={`/titles/${e.titleId}`} icon={icons.arrowLeft}>Back</Button>
          <Button size="sm" onClick={() => setPanel(true)} icon={icons.bookmark}>Bookmarks &amp; notes</Button>
        </Row>
        <span className="lt-reader-title"><Text as="span" size="sm" clamp={1}>{e.label || ""}</Text></span>
        <Row>
          <IconButton aria-label="Previous page" onClick={() => step(-1)}>‹</IconButton>
          <IconButton aria-label="Next page" onClick={() => step(1)}>›</IconButton>
          <AnchoredPanel open={settings} onOpenChange={setSettings} label="View settings" icon={icons.sliders} text="View">
            <Stack>
              <SegmentedField label="Fit" value={style.fit} onValue={(v) => changeStyle({ fit: v as Style["fit"] })} items={[{ value: "height", label: "Fit page" }, { value: "width", label: "Fit width" }, { value: "original", label: "Original size" }]} />
              <SegmentedField label="Reading direction" value={style.dir} onValue={(v) => changeStyle({ dir: v as Style["dir"] })} items={[{ value: "ltr", label: "Left to right" }, { value: "rtl", label: "Right to left (manga)" }]} />
              <SegmentedField label="Background" value={style.dark ? "dark" : "light"} onValue={(v) => changeStyle({ dark: v === "dark" })} items={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
              <SegmentedField label="Toolbar" value={quiet.toolbar} onValue={(v) => quiet.changeToolbar(v === "always" ? "always" : "auto")} items={[{ value: "auto", label: "Auto-hide" }, { value: "always", label: "Always show" }]} />
            </Stack>
          </AnchoredPanel>
        </Row>
      </header>

      <div className="lt-reader-banners">
        {pend.offline && pend.items.length > 0 && <Alert tone="warning" data-testid="offline-banner">The server cannot be reached. Your changes are kept on this device and sent when it returns. <TextLink to="/pending">Details</TextLink></Alert>}
        {notice && <Alert tone="warning" onClose={() => setNotice(null)}>{notice}</Alert>}
        {sv === "changed" && <Alert tone="warning" role="alert" title="This file changed">A newer version of the file exists, so your page is no longer being saved. <Button size="sm" onClick={() => location.reload()} icon={icons.reset}>Reload</Button></Alert>}
        {sv === "conflict" && (
          <Alert tone="warning" role="alert" title="Your place changed elsewhere">
            <Row><Text as="span" size="sm">{serverPos ? `Saved from ${serverPos.deviceName || "another device"}.` : "A different page was saved."}</Text>
              {serverPos && <Button size="sm" variant="primary" onClick={async () => { const loc = await saver.useServer(); if (loc?.kind === "comic-page") { const i = m.pages.findIndex((p) => p.entryId === loc.entryId); if (i >= 0) setIndex(i); } }} icon={icons.chevRight}>Go to saved page</Button>}
              <Button size="sm" onClick={() => void saver.keepMine()} icon={icons.check}>Keep my page</Button></Row>
            {saver.resolveError && <Text size="sm" tone="danger" data-testid="resolve-error">Not changed: {saver.resolveError} Both places are still kept.</Text>}
          </Alert>
        )}
      </div>

      <div className="lt-comic-stage" data-fit={style.fit} data-testid="comic-stage"
        onClick={(ev) => { if ((ev.target as HTMLElement).closest("button")) return; const r = ev.currentTarget.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width; if (x < 0.3) step(-1); else if (x > 0.7) step(1); }}>
        {typeof current === "string" && current ? (
          <img className="lt-comic-page" src={current} alt={`Page ${index + 1}`} data-testid="comic-page" data-index={index} data-entry={m.pages[index].entryId} draggable={false} />
        ) : current instanceof Error ? (
          <Alert tone="danger" role="alert" data-testid="page-error">
            {current instanceof ApiError && current.status === 409 ? "This page is not available right now; the pages may need to be prepared again." :
              current instanceof ApiError && current.status === 412 ? "This file was replaced; reload to open the new version." : "This page could not be loaded."}
          </Alert>
        ) : <Busy />}
        <QuietReveal barOn={quiet.barOn} reveal={quiet.reveal} />
        <BookmarkRibbon on={!!bookmarkHere} label={bookmarkHere ? "Remove bookmark" : "Bookmark"} onToggle={toggleBookmark} />
      </div>

      <footer className="lt-reader-foot">
        <div className="lt-grow">
          <ReadingTimeline value={n > 1 ? Math.round((index / (n - 1)) * 100) : 100} label="Page in the book" marks={marks}
            onSeek={(f) => go(Math.round(f * (n - 1)))} />
        </div>
        <Text as="span" size="sm" mono data-testid="comic-progress">Page {index + 1} of {n}</Text>
        <Badge tone={sv === "saving" || sv === "offline" ? "neutral" : "success"} data-testid="save-status">
          {sv === "saving" ? "saving" : sv === "offline" ? "waiting to send" : sv === "saved" ? "position saved" : sv === "conflict" ? "paused" : ""}</Badge>
      </footer>

      <Drawer open={panel} onClose={() => setPanel(false)} title="Bookmarks & notes" side="left">
        <Stack gap="sm">
          <Button size="sm" onClick={() => setNoteDraft("")} icon={icons.pencil}>Add note for this page</Button>
          <Text size="xs" tone="dim">Text highlights are not available for image pages.</Text>
          {items.length === 0 && <Text tone="dim" size="sm">Nothing yet.</Text>}
          {items.map((a) => {
            const pi = pageOf(a);
            return (
              <Card key={a.id} pad="sm" data-testid="annotation-item">
                <Stack gap="xs">
                  <Row justify="between"><Badge tone={a.data!.kind === "note" ? "info" : "neutral"}>{a.data!.kind}</Badge>
                    <Row gap="xs">{pi >= 0 && <Text as="span" size="xs" tone="dim">page {pi + 1}</Text>}{a.unsaved && <Badge outline tone="neutral" data-testid="unsaved">not saved yet</Badge>}</Row></Row>
                  {a.data!.text && <Text size="sm">{a.data!.text}</Text>}
                  <Row>
                    <Button size="sm" disabled={pi < 0} onClick={() => { go(pi); setPanel(false); }} icon={icons.chevRight}>Go to page</Button>
                    <Button size="sm" variant="danger" onClick={() => del(a)} icon={icons.trash}>Delete</Button>
                  </Row>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      </Drawer>

      <Drawer open={noteDraft !== null} onClose={() => setNoteDraft(null)} title={`Note for page ${index + 1}`}
        actions={<><Button onClick={() => setNoteDraft(null)} icon={icons.close}>Cancel</Button>
          <Button variant="primary" disabled={!(noteDraft ?? "").trim()} onClick={() => { put(crypto.randomUUID(), { kind: "note", anchor: anchor(), selection: null, text: noteDraft!, quote: "" }, "Note"); setNoteDraft(null); }} icon={icons.save}>Save note</Button></>}>
        <TextAreaField label="Note" rows={4} maxLength={65536} autoFocus value={noteDraft ?? ""} onValue={setNoteDraft} />
      </Drawer>
    </div>
  );
}
