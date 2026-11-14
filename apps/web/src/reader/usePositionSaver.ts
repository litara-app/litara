import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, get, op } from "../api/client";
import type { Locator, PositionState } from "../api/types";

export type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "changed" | "error";

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
 * Debounced, serialized position writes. Every write carries the revision it
 * was based on; a 409 pauses saving and lets the reader choose between the
 * saved position and the one just read (revision-aware resume, ADR-0065).
 * Writes from a hidden tab are flushed with keepalive.
 */
export function usePositionSaver({ editionId, fileId, contentVersion, initialRevision }: Opts) {
  const rev = useRef(initialRevision);
  const pending = useRef<Locator | null>(null);
  const timer = useRef<number>(0);
  const inflight = useRef(false);
  const paused = useRef(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    if (inflight.current || paused.current || !pending.current) return;
    const locator = pending.current;
    inflight.current = true;
    setStatus("saving");
    try {
      const st = await api<PositionState>("PUT", `/editions/${editionId}/position`, {
        ...op(rev.current),
        anchor: { fileId, contentVersion, locator },
      });
      rev.current = st.revision;
      if (pending.current === locator) pending.current = null;
      setStatus("saved");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "stale_revision") {
        paused.current = true;
        const server = await get<PositionState>(`/editions/${editionId}/position`).catch(() => null);
        if (server) setConflict({ conflictId: String(e.problem.conflictId), server });
        setStatus("conflict");
      } else if (e instanceof ApiError && e.status === 412) {
        paused.current = true; // the file changed under us; saving more would only add conflicts
        setStatus("changed");
      } else {
        setStatus("error");
      }
    } finally {
      inflight.current = false;
      if (pending.current && !paused.current && status !== "error") timer.current = window.setTimeout(() => void flush(), 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editionId, fileId, contentVersion]);

  const schedule = useCallback((locator: Locator) => {
    pending.current = locator;
    if (!paused.current) setStatus("saving"); // a newer location is waiting to be written
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 1500);
  }, [flush]);

  // Flush when the tab is hidden and when leaving the page.
  useEffect(() => {
    const now = () => { clearTimeout(timer.current); void flush(); };
    const vis = () => { if (document.visibilityState === "hidden") now(); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); now(); };
  }, [flush]);

  /** Keep the reader's current location: apply it on top of the server revision. */
  const keepMine = useCallback(async () => {
    if (!conflict) return;
    const { conflictId, server } = conflict;
    try {
      const r = await api<{ revision: string }>("POST", `/personal-conflicts/${conflictId}/resolve`, {
        ...op(server.revision), choice: "use_candidate", contentVersion,
      });
      rev.current = r.revision;
    } catch {
      rev.current = server.revision; // fall back to writing from the server revision
    }
    setConflict(null);
    paused.current = false;
    setStatus("idle");
    void flush();
  }, [conflict, contentVersion, flush]);

  /** Adopt the saved position: resolve keeping the server state and return where to go. */
  const useServer = useCallback(async (): Promise<Locator | null> => {
    if (!conflict) return null;
    const { conflictId, server } = conflict;
    await api("POST", `/personal-conflicts/${conflictId}/resolve`, {
      ...op(server.revision), choice: "keep_server", contentVersion: null,
    }).catch(() => undefined);
    rev.current = server.revision;
    pending.current = null;
    setConflict(null);
    paused.current = false;
    setStatus("saved");
    return server.position?.anchor.contentVersion === contentVersion ? server.position.anchor.locator : null;
  }, [conflict, contentVersion]);

  return { schedule, status, conflict, keepMine, useServer };
}
