import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { AudioPositionState, AudioRecording } from "../api/types";
import { usePendingQueue, usePendingState } from "../pending/PendingProvider";
import type { Checkpoint } from "./useAudioPlayer";

export interface PositionConflict { conflictId: string; server: AudioPositionState }

/**
 * Listening positions and completion go through the durable pending queue
 * (ADR-0068): stored before sending, original operation IDs on every retry,
 * and never shown as saved until the server accepted them. A 409 pauses
 * saving and lets the listener choose; a 412 means the recording changed.
 */
export function useRecordingSync(recording: AudioRecording, initialRevision: string) {
  const queue = usePendingQueue();
  const state = usePendingState();
  const id = recording.id;
  const posKey = `rpos:${id}`;
  const confirmed = useRef(Number(initialRevision));
  const completionRev = useRef(Number(recording.completion.revision));
  const paused = useRef(false);
  const [conflict, setConflict] = useState<PositionConflict | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const [sentOnce, setSentOnce] = useState(false);
  const [finished, setFinished] = useState(recording.completion.finished);

  const savePosition = useCallback((c: Checkpoint) => {
    if (paused.current) return;
    const opId = crypto.randomUUID();
    void queue.enqueue({
      id: opId, kind: "recording-position", resourceKey: posKey, editionId: id, method: "PUT", path: `/recordings/${id}/position`, label: "Listening position",
      confirmedRevision: confirmed.current, coalesce: true,
      body: (base) => ({ operationId: opId, baseRevision: base, layoutRevision: recording.layoutRevision,
        position: { fileId: c.fileId, contentVersion: c.contentVersion, offsetMs: c.offsetMs, capturedAt: new Date().toISOString() } }),
    });
  }, [queue, id, posKey, recording.layoutRevision]);

  const writeCompletion = useCallback((event: "natural_end" | "manual_finish" | "manual_unfinish", final: Checkpoint | null) => {
    const opId = crypto.randomUUID();
    void queue.enqueue({
      id: opId, kind: "recording-completion", resourceKey: `rcomp:${id}`, editionId: id, method: "PUT", path: `/recordings/${id}/completion`,
      label: event === "manual_unfinish" ? "Mark unfinished" : "Finished", confirmedRevision: completionRev.current,
      body: (base) => ({ operationId: opId, baseRevision: base, layoutRevision: recording.layoutRevision, event, capturedAt: new Date().toISOString(),
        finalPosition: final }),
    });
    setFinished(event !== "manual_unfinish");
  }, [queue, id, recording.layoutRevision]);

  useEffect(() => queue.onSent((op, resp) => {
    const rev = Number((resp as { revision?: string }).revision);
    if (op.resourceKey === posKey) { confirmed.current = rev; setSentOnce(true); }
    if (op.resourceKey === `rcomp:${id}`) { completionRev.current = rev; setFinished((resp as { finished: boolean }).finished); }
  }), [queue, posKey, id]);

  useEffect(() => queue.onConflict((op, problem) => {
    if (op.resourceKey === `rcomp:${id}`) { setFinished(recording.completion.finished); return; }
    if (op.resourceKey !== posKey) return;
    paused.current = true;
    if (problem.code === "position_conflict" && problem.current) { setConflict({ conflictId: String(problem.conflictId), server: problem.current as AudioPositionState }); return; }
    setChanged(String(problem.code) === "recording_repaired" ? "This recording was replaced by a reviewed repair. Open its successor recordings from the title page." : "This recording changed on the server. Reload to continue from the saved place.");
  }), [queue, posKey, id, recording.completion.finished]);

  const dropQueued = useCallback(async () => { for (const o of queue.forKey(posKey)) await queue.discard(o.id); }, [queue, posKey]);

  /** Resolve with the server (position null): keep_server adopts the saved place; use_candidate keeps mine. */
  const resolve = useCallback(async (choice: "keep_server" | "use_candidate", conflictId: string, serverRevision: string) => {
    const r = await api<AudioPositionState>("POST", `/recordings/${id}/conflicts/${conflictId}/resolve`, {
      operationId: crypto.randomUUID(), baseRevision: serverRevision, layoutRevision: recording.layoutRevision, choice, position: null,
    });
    confirmed.current = Number(r.revision);
    await dropQueued();
    setConflict(null);
    paused.current = false;
    return r;
  }, [id, recording.layoutRevision, dropQueued]);

  const queued = state.items.some((o) => o.resourceKey === posKey && o.status === "pending");
  const status = conflict ? "conflict" : changed ? "changed" : queued ? (state.offline ? "offline" : "saving") : sentOnce ? "saved" : "idle";
  return { savePosition, writeCompletion, resolve, conflict, changed, status, finished, setRevision: (r: string) => { confirmed.current = Number(r); } };
}
