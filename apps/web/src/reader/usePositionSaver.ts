import { useCallback, useEffect, useRef, useState } from "react";
import { api, get } from "../api/client";
import type { Locator, PositionState } from "../api/types";
import { usePendingQueue, usePendingState } from "../pending/PendingProvider";

export type SaveStatus = "idle" | "saving" | "offline" | "saved" | "conflict" | "changed" | "error";

export interface Conflict {
  conflictId: string;
  server: PositionState;
}

interface Opts {
  editionId: string;
  fileId: string;
  contentVersion: string;
  initialRevision: string;
}

/**
 * Reading-position writes go through the durable pending queue (ADR-0068): each
 * is stored before it is sent, keeps its operation ID and base revision across
 * retries, and is never shown as saved until the server accepted it. A 409
 * pauses saving and lets the reader choose between the saved place and the
 * one just read (revision-aware resume, ADR-0065).
 */
export function usePositionSaver({ editionId, fileId, contentVersion, initialRevision }: Opts) {
  const queue = usePendingQueue();
  const state = usePendingState();
  const key = `position:${editionId}`;
  const confirmed = useRef(Number(initialRevision));
  const pending = useRef<Locator | null>(null);
  const timer = useRef<number>(0);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [changed, setChanged] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const paused = useRef(false);

  const submit = useCallback(() => {
    const locator = pending.current;
    if (!locator || paused.current) return;
    pending.current = null;
    const id = crypto.randomUUID();
    void queue.enqueue({
      id, kind: "position", resourceKey: key, editionId, method: "PUT", path: `/editions/${editionId}/position`, label: "Reading position",
      confirmedRevision: confirmed.current, coalesce: true,
      body: (base) => ({ operationId: id, baseRevision: base, capturedAt: new Date().toISOString(), anchor: { fileId, contentVersion, locator } }),
    });
  }, [queue, key, editionId, fileId, contentVersion]);

  const schedule = useCallback((locator: Locator) => {
    pending.current = locator;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(submit, 1500);
  }, [submit]);

  useEffect(() => queue.onSent((op, resp) => {
    if (op.resourceKey !== key) return;
    confirmed.current = Number((resp as PositionState).revision);
    setSentOnce(true);
  }), [queue, key]);

  useEffect(() => queue.onConflict((op, problem) => {
    if (op.resourceKey !== key) return;
    paused.current = true;
    if (op.status === "conflict" && Number(problem.status) === 412) { setChanged(true); return; }
    void get<PositionState>(`/editions/${editionId}/position`).then((server) => setConflict({ conflictId: String(problem.conflictId), server })).catch(() => setChanged(true));
  }), [queue, key, editionId]);

  // Persist the last location when the tab is hidden or the page is left.
  useEffect(() => {
    const now = () => { clearTimeout(timer.current); submit(); };
    const vis = () => { if (document.visibilityState === "hidden") now(); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); now(); };
  }, [submit]);

  const dropQueued = useCallback(async () => {
    for (const o of queue.forKey(key)) await queue.discard(o.id); // later positions are superseded by the choice
  }, [queue, key]);

  /** Keep the reader's current location: the server applies it on top of the saved revision. */
  const keepMine = useCallback(async () => {
    if (!conflict) return;
    const { conflictId, server } = conflict;
    try {
      const r = await api<{ revision: string }>("POST", `/personal-conflicts/${conflictId}/resolve`, {
        operationId: crypto.randomUUID(), baseRevision: server.revision, choice: "use_candidate", contentVersion,
      });
      confirmed.current = Number(r.revision);
    } catch {
      confirmed.current = Number(server.revision);
    }
    await dropQueued();
    setConflict(null);
    paused.current = false;
  }, [conflict, contentVersion, dropQueued]);

  /** Adopt the saved position and return where to go. */
  const useServer = useCallback(async (): Promise<Locator | null> => {
    if (!conflict) return null;
    const { conflictId, server } = conflict;
    await api("POST", `/personal-conflicts/${conflictId}/resolve`, {
      operationId: crypto.randomUUID(), baseRevision: server.revision, choice: "keep_server", contentVersion: null,
    }).catch(() => undefined);
    confirmed.current = Number(server.revision);
    pending.current = null;
    await dropQueued();
    setConflict(null);
    paused.current = false;
    return server.position?.anchor.contentVersion === contentVersion ? server.position.anchor.locator : null;
  }, [conflict, contentVersion, dropQueued]);

  const queued = state.items.some((o) => o.resourceKey === key && o.status === "pending");
  const status: SaveStatus = conflict ? "conflict" : changed ? "changed"
    : queued || pending.current ? (state.offline ? "offline" : "saving") : sentOnce ? "saved" : "idle";
  return { schedule, status, conflict, keepMine, useServer };
}
