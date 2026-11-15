import { ActionIcon, Alert, Badge, Button, Drawer, Group, Modal, SegmentedControl, Slider, Stack, Text, Textarea } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, get } from "../api/client";
import type { Annotation, AnnotationData, Edition, Locator, Page, ReaderSnapshot } from "../api/types";
import { useEditionPending, usePendingQueue, usePendingState } from "../pending/PendingProvider";
import { Busy } from "../ui/common";
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
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    let problem: Record<string, unknown> = {};
    try { problem = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(res.status, problem);
  }
  return URL.createObjectURL(await res.blob());
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
    return <Stack p="md" maw={560}><Alert color="red" title="The pages could not be requested">{(manifest.error as Error).message}</Alert><Button component={Link} to={`/editions/${e.id}`} variant="default">Back</Button></Stack>;
  }
  const m = manifest.data;
  const back = <Button component={Link} to={`/titles/${e.titleId}`} variant="default" size="compact-sm">Back</Button>;
  const download = e.file.contentPath && <Button component="a" href={e.file.contentPath} download size="compact-sm">Download original</Button>;
  if (m.state === "processing") {
    return <Stack p="md" maw={560} data-testid="comic-processing"><Busy /><Text ta="center">Preparing the pages. This happens once per file version.</Text><Group justify="center">{back}</Group></Stack>;
  }
  if (m.state === "unsupported") {
    return (
      <Stack p="md" maw={560} data-testid="comic-unsupported">
        <Alert color="orange" title="These pages cannot be shown in the browser">
          {m.issues.map((i) => i.detail).join(" ") || "This archive cannot be read as comic pages."}{" "}
          Your original file is untouched{e.file.format !== "cbz" ? ` (${e.file.format.toUpperCase()} extraction is not available yet)` : ""}.
        </Alert>
        <Group>{back}{download}</Group>
      </Stack>
    );
  }
  if (m.state === "incomplete") {
    return (
      <Stack p="md" maw={560}>
        <Alert color="yellow" title="The pages are not ready">{m.issues.map((i) => i.detail).join(" ") || "Extraction did not finish."}</Alert>
        <Group>{back}<Button size="compact-sm" onClick={() => void manifest.retryPrepare()}>Try again</Button></Group>
      </Stack>
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
  const annotations = useQuery({ queryKey: annKey, queryFn: () => get<Page<Annotation>>(`/editions/${e.id}/annotations?includeDeleted=false&size=200`) });
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

  const current = urls[index];
  const bg = style.dark ? "#111" : "#eee";
  const sv = saver.status;
  const serverPos = saver.conflict?.server.position;
  const imgStyle = style.fit === "width" ? { width: "100%", height: "auto" } : style.fit === "height" ? { maxHeight: "100%", maxWidth: "100%", objectFit: "contain" as const } : {};

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: bg }}>
      <Group px="sm" py={6} justify="space-between" wrap="nowrap" style={{ background: "var(--mantine-color-body)", borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group gap="xs" wrap="nowrap">
          <Button component={Link} to={`/titles/${e.titleId}`} size="compact-sm" variant="default">Back</Button>
          <Button size="compact-sm" variant="default" onClick={() => setPanel(true)}>Bookmarks &amp; notes</Button>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <ActionIcon variant="default" aria-label="Previous page" onClick={() => step(-1)}>‹</ActionIcon>
          <ActionIcon variant="default" aria-label="Next page" onClick={() => step(1)}>›</ActionIcon>
          <Button size="compact-sm" variant="default" onClick={() => put(crypto.randomUUID(), { kind: "bookmark", anchor: anchor(), selection: null, text: `Page ${index + 1}`, quote: "" }, "Bookmark")}>Bookmark</Button>
          <Button size="compact-sm" variant="default" onClick={() => setSettings(true)}>View</Button>
        </Group>
      </Group>

      {pend.offline && pend.items.length > 0 && <Alert color="yellow" m="xs" data-testid="offline-banner">The server cannot be reached. Your changes are kept on this device and sent when it returns. <Link to="/pending">Details</Link></Alert>}
      {notice && <Alert color="yellow" m="xs" withCloseButton onClose={() => setNotice(null)}>{notice}</Alert>}
      {sv === "changed" && <Alert color="orange" m="xs" role="alert" title="This file changed">A newer version of the file exists, so your page is no longer being saved. <Button size="compact-xs" onClick={() => location.reload()}>Reload</Button></Alert>}
      {sv === "conflict" && (
        <Alert color="orange" m="xs" role="alert" title="Your place changed elsewhere">
          <Group gap="xs"><Text size="sm">{serverPos ? `Saved from ${serverPos.deviceName || "another device"}.` : "A different page was saved."}</Text>
            {serverPos && <Button size="compact-xs" onClick={async () => { const loc = await saver.useServer(); if (loc?.kind === "comic-page") { const i = m.pages.findIndex((p) => p.entryId === loc.entryId); if (i >= 0) setIndex(i); } }}>Go to saved page</Button>}
            <Button size="compact-xs" variant="default" onClick={() => void saver.keepMine()}>Keep my page</Button></Group>
        </Alert>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: style.fit === "height" ? "hidden" : "auto", display: "flex", justifyContent: "center", alignItems: style.fit === "height" ? "center" : "flex-start", position: "relative" }}
        data-testid="comic-stage"
        onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width; if (x < 0.3) step(-1); else if (x > 0.7) step(1); }}>
        {typeof current === "string" && current ? (
          <img src={current} alt={`Page ${index + 1}`} data-testid="comic-page" data-index={index} data-entry={m.pages[index].entryId} style={imgStyle} draggable={false} />
        ) : current instanceof Error ? (
          <Alert color="red" m="md" role="alert" data-testid="page-error">
            {current instanceof ApiError && current.status === 409 ? "This page is not available right now; the pages may need to be prepared again." :
              current instanceof ApiError && current.status === 412 ? "This file was replaced; reload to open the new version." : "This page could not be loaded."}
          </Alert>
        ) : <Busy />}
      </div>

      <div style={{ background: "var(--mantine-color-body)", borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Group px="sm" py={6} gap="md" wrap="nowrap">
          <Slider style={{ flex: 1 }} min={1} max={Math.max(n, 2)} value={index + 1} onChange={(v) => go(v - 1)} disabled={n < 2} aria-label="Page" thumbLabel="Page" label={(v) => `Page ${v}`} inverted={style.dir === "rtl"} />
          <Text size="sm" ff="monospace" data-testid="comic-progress">Page {index + 1} of {n}</Text>
          <Badge size="xs" variant="light" color={sv === "saving" || sv === "offline" ? "gray" : "green"} data-testid="save-status">
            {sv === "saving" ? "saving" : sv === "offline" ? "waiting to send" : sv === "saved" ? "position saved" : sv === "conflict" ? "paused" : ""}</Badge>
        </Group>
      </div>

      <Drawer opened={panel} onClose={() => setPanel(false)} title="Bookmarks & notes" position="right" size="md">
        <Stack gap="xs">
          <Button size="compact-sm" variant="default" onClick={() => setNoteDraft("")}>Add note for this page</Button>
          <Text size="xs" c="dimmed">Text highlights are not available for image pages.</Text>
          {items.length === 0 && <Text c="dimmed" size="sm">Nothing yet.</Text>}
          {items.map((a) => {
            const pi = pageOf(a);
            return (
              <Stack key={a.id} gap={2} p="xs" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 6 }} data-testid="annotation-item">
                <Group justify="space-between"><Badge variant="light" color={a.data!.kind === "note" ? "blue" : "gray"}>{a.data!.kind}</Badge>
                  <Group gap={4}>{pi >= 0 && <Text size="xs" c="dimmed">page {pi + 1}</Text>}{a.unsaved && <Badge variant="outline" color="gray" data-testid="unsaved">not saved yet</Badge>}</Group></Group>
                {a.data!.text && <Text size="sm">{a.data!.text}</Text>}
                <Group gap="xs">
                  <Button size="compact-xs" variant="default" disabled={pi < 0} onClick={() => { go(pi); setPanel(false); }}>Go to page</Button>
                  <Button size="compact-xs" color="red" variant="subtle" onClick={() => del(a)}>Delete</Button>
                </Group>
              </Stack>
            );
          })}
        </Stack>
      </Drawer>

      <Drawer opened={settings} onClose={() => setSettings(false)} title="View" position="bottom" size="auto">
        <Stack pb="md">
          <SegmentedControl value={style.fit} onChange={(v) => changeStyle({ fit: v as Style["fit"] })} data={[{ value: "height", label: "Fit page" }, { value: "width", label: "Fit width" }, { value: "original", label: "Actual size" }]} />
          <SegmentedControl value={style.dir} onChange={(v) => changeStyle({ dir: v as Style["dir"] })} data={[{ value: "ltr", label: "Left to right" }, { value: "rtl", label: "Right to left (manga)" }]} />
          <SegmentedControl value={style.dark ? "dark" : "light"} onChange={(v) => changeStyle({ dark: v === "dark" })} data={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
        </Stack>
      </Drawer>

      <Modal opened={noteDraft !== null} onClose={() => setNoteDraft(null)} title={`Note for page ${index + 1}`}>
        <Stack>
          <Textarea label="Note" autosize minRows={3} maxLength={65536} data-autofocus value={noteDraft ?? ""} onChange={(ev) => setNoteDraft(ev.currentTarget.value)} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setNoteDraft(null)}>Cancel</Button>
            <Button disabled={!(noteDraft ?? "").trim()} onClick={() => { put(crypto.randomUUID(), { kind: "note", anchor: anchor(), selection: null, text: noteDraft!, quote: "" }, "Note"); setNoteDraft(null); }}>Save note</Button></Group>
        </Stack>
      </Modal>
    </div>
  );
}
