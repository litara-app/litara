import { useCallback, useEffect, useRef } from "react";
import { api } from "../api/client";

const TICK_MS = 5000;
const SEND_MS = 30_000;
const SESSION_GAP_MS = 30 * 60_000; // a longer pause ends the session (ADR-0109)
// A background tab may run its timer only once a minute while audio keeps playing. A longer silence than this means the
// computer slept, so that time is not counted.
const MAX_STEP_MS = 90_000;

/**
 * Records this account's listening (ADR-0109): wall-clock seconds during which audio actually played, so speed does not
 * change the count and pauses and buffering are left out. It keeps counting while the tab is hidden. The session is sent
 * under its own id about every thirty seconds, on pause and when the page is left. A failed send is retried with the
 * next one; the web keeps no offline queue. `fraction` is where the listener is in the recording, from 0 to 1.
 */
export function useListeningSession(recordingId: string, audible: boolean, fraction: number | null) {
  const s = useRef({ id: "", startedAt: 0, countedTo: null as number | null, lastHeard: 0, listened: 0, startFraction: null as number | null, endFraction: null as number | null, dirty: false });
  const fractionRef = useRef(fraction);
  fractionRef.current = fraction;

  /** Adds the time played since the last call, while audio is playing. */
  const count = useCallback(() => {
    const x = s.current;
    if (x.countedTo === null) return;
    const now = Date.now();
    const step = now - x.countedTo;
    x.countedTo = now;
    if (step <= 0 || step > MAX_STEP_MS) return;
    x.listened += step / 1000;
    x.lastHeard = now;
    if (fractionRef.current !== null) x.endFraction = fractionRef.current;
    x.dirty = true;
  }, []);

  const flush = useCallback(() => {
    count();
    const x = s.current;
    if (!x.id || !x.dirty || x.listened < 5) return;
    x.dirty = false;
    const body = {
      startedAt: new Date(x.startedAt).toISOString(), endedAt: new Date(Math.max(x.lastHeard, x.startedAt)).toISOString(),
      listenedSeconds: Math.min(86400, Math.round(x.listened)),
      ...(x.startFraction !== null ? { startFraction: x.startFraction } : {}), ...(x.endFraction !== null ? { endFraction: x.endFraction } : {}),
    };
    const id = x.id;
    // A conflict (an id the server holds for another recording) cannot be fixed by retrying.
    api("PUT", `/recordings/${recordingId}/listening-sessions/${id}`, body).catch((err: unknown) => {
      if ((err as { status?: number })?.status !== 409) x.dirty = true;
      else if (x.id === id) x.id = "";
    });
  }, [count, recordingId]);

  useEffect(() => {
    if (!audible) return;
    const x = s.current;
    const now = Date.now();
    if (x.id && (now - x.lastHeard > SESSION_GAP_MS || now - x.startedAt > 23 * 3600_000)) x.id = "";
    if (!x.id) Object.assign(x, { id: crypto.randomUUID(), startedAt: now, lastHeard: now, listened: 0, startFraction: fractionRef.current, endFraction: fractionRef.current, dirty: false });
    x.countedTo = now;
    const tick = setInterval(count, TICK_MS);
    const send = setInterval(flush, SEND_MS);
    return () => {
      clearInterval(tick); clearInterval(send);
      flush(); // counts up to the pause
      x.countedTo = null;
    };
  }, [audible, count, flush]);

  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);
}
