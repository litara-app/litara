import { useCallback, useEffect, useRef } from "react";
import { api } from "../api/client";

const TICK_MS = 5000;
const SEND_MS = 30_000;
const ACTIVE_WINDOW_MS = 2 * 60_000; // activity in the last two minutes counts as reading
const SESSION_GAP_MS = 30 * 60_000; // a longer pause ends the session (ADR-0092)

/**
 * Records this account's reading sessions (ADR-0092). Active time counts only while the page is visible and the person
 * has done something in the last two minutes; a pause of thirty minutes starts a new session. The session is sent under
 * its own id about every thirty seconds and when the page is hidden, and the server keeps the longest one it has seen.
 * Call `touch` for anything that shows the person is reading (turning a page, a key press). `fraction` is where they are
 * in the book from 0 to 1, when known. A failed send is retried with the next one; nothing is queued offline.
 */
export function useReadingSession(editionId: string, fraction: number | null, enabled: boolean) {
  const s = useRef({ id: "", startedAt: 0, lastTouch: 0, lastTick: 0, active: 0, startFraction: null as number | null, endFraction: null as number | null, dirty: false, sent: 0 });
  const fractionRef = useRef(fraction);
  fractionRef.current = fraction;

  const flush = useCallback(() => {
    const x = s.current;
    if (!x.id || !x.dirty || x.active < 5) return;
    x.dirty = false;
    const body = {
      startedAt: new Date(x.startedAt).toISOString(), endedAt: new Date(Math.max(x.lastTick, x.startedAt)).toISOString(),
      activeSeconds: Math.min(86400, Math.round(x.active)),
      ...(x.startFraction !== null ? { startFraction: x.startFraction } : {}), ...(x.endFraction !== null ? { endFraction: x.endFraction } : {}),
    };
    api("PUT", `/editions/${editionId}/reading-sessions/${x.id}`, body).catch(() => { x.dirty = true; }); // retried with the next send
  }, [editionId]);

  const touch = useCallback(() => {
    const x = s.current;
    const now = Date.now();
    if (x.id && now - x.lastTouch > SESSION_GAP_MS) { flush(); x.id = ""; }
    if (!x.id) Object.assign(x, { id: crypto.randomUUID(), startedAt: now, lastTick: now, active: 0, startFraction: fractionRef.current, endFraction: fractionRef.current, dirty: false });
    x.lastTouch = now;
  }, [flush]);

  // Where the person is changes the end of the session, and turning a page is activity.
  useEffect(() => {
    if (!enabled || fraction === null) return;
    touch();
    const x = s.current;
    if (x.startFraction === null) x.startFraction = fraction;
    x.endFraction = fraction;
    x.dirty = true;
  }, [fraction, enabled, touch]);

  useEffect(() => {
    if (!enabled) return;
    const seen = () => touch();
    const events = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;
    for (const ev of events) window.addEventListener(ev, seen, { passive: true });
    const tick = setInterval(() => {
      const x = s.current;
      const now = Date.now();
      if (x.id && document.visibilityState === "visible" && now - x.lastTouch < ACTIVE_WINDOW_MS) {
        x.active += Math.min(TICK_MS * 2, now - x.lastTick) / 1000;
        x.lastTick = now;
        x.dirty = true;
      } else x.lastTick = now;
    }, TICK_MS);
    const send = setInterval(flush, SEND_MS);
    const hide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", flush);
    return () => {
      for (const ev of events) window.removeEventListener(ev, seen);
      clearInterval(tick); clearInterval(send);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [enabled, touch, flush]);
}
