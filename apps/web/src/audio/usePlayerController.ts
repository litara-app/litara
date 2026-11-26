import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { AudioPositionState, AudioRecording } from "../api/types";
import { usePendingState } from "../pending/PendingProvider";
import { chaptersOf, currentChapter, nextTarget, previousTarget } from "./chapters";
import { FADE_MS, fadeVolume, remainingMs, startSleep, type SleepChoice, type SleepTimer } from "./sleep";
import { startOffsets, totalMs } from "./timeline";
import { useAudioPlayer } from "./useAudioPlayer";
import { useListeningSession } from "./useListeningSession";
import { useRecordingSync } from "./useRecordingSync";

export type PlayerController = ReturnType<typeof usePlayerController>;

/**
 * Everything the minimized and full-screen players share: playback, saved position and conflicts, chapters (and skipping
 * between them), the sleep timer, the media session and keyboard shortcuts.
 */
export function usePlayerController({ recording: r, initial, autoplay, token }: { recording: AudioRecording; initial: AudioPositionState; autoplay: boolean; token: number }) {
  const sync = useRecordingSync(r, initial.revision);
  const pend = usePendingState();
  const ready = r.readiness === "ready" && r.capabilities.play && r.files.every((f) => f.durationMs);
  const player = useAudioPlayer({
    recording: r,
    onCheckpoint: sync.savePosition,
    onEnded: (final) => sync.writeCompletion("natural_end", final),
  });
  const timed = useMemo(() => r.files.map((f) => ({ id: f.id, durationMs: f.durationMs ?? 0 })), [r.files]);
  const total = totalMs(timed);
  useListeningSession(r.id, player.playing && !player.buffering, total > 0 ? Math.min(1, Math.max(0, player.whole / total)) : null);
  const offsets = useMemo(() => startOffsets(timed), [timed]);
  const chapters = useMemo(() => chaptersOf(r, offsets), [r, offsets]);
  const chapter = currentChapter(chapters, player.whole);
  const [scrub, setScrub] = useState<number | null>(null);
  const [resolveError, setResolveError] = useState<unknown>(null);
  const [chosen, setChosen] = useState(false);

  // Resume at the saved place only when it still belongs to this exact layout; otherwise start at the beginning. A listener who
  // pressed play also starts playing.
  const saved = initial.position;
  useEffect(() => {
    if (saved && saved.layoutRevision === r.layoutRevision) player.restore(saved.fileId, saved.contentVersion, saved.offsetMs);
    if (autoplay && ready) void player.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);
  // Pressing play again on the same book while it is already open just starts it.
  const firstToken = useRef(token);
  useEffect(() => {
    if (token !== firstToken.current && autoplay && ready) void player.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Explicit candidates (for example after a recording repair) are offered, never applied.
  const candidates = !saved ? initial.unresolvedConflicts.filter((x) => x.candidate) : [];

  const prevChapter = useCallback(() => { const t = previousTarget(chapters, player.whole); if (t !== null) player.seekWhole(t); }, [chapters, player]);
  const nextChapter = useCallback(() => { const t = nextTarget(chapters, player.whole); if (t !== null) player.seekWhole(t); }, [chapters, player]);
  const hasChapters = chapters.length > 0;
  const canNext = nextTarget(chapters, player.whole) !== null;

  // ---- sleep timer
  const [choice, setChoice] = useState<SleepChoice>("off");
  const [timer, setTimer] = useState<SleepTimer | null>(null);
  const [, tick] = useState(0);
  const live = useRef({ whole: 0, rate: 1 });
  live.current = { whole: player.whole, rate: player.rate };
  const setSleep = useCallback((c: SleepChoice) => {
    setChoice(c);
    setTimer(startSleep(c, Date.now(), live.current.whole, chapters, total));
    player.setVolume(1);
  }, [chapters, total, player]);
  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => {
      const left = remainingMs(timer, Date.now(), live.current.whole, live.current.rate);
      if (left <= 0) {
        player.pause();
        player.setVolume(1);
        setTimer(null);
        setChoice("off");
        return;
      }
      player.setVolume(left < FADE_MS ? fadeVolume(left) : 1);
      tick((n) => n + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, [timer, player]);
  const sleepLeft = timer ? Math.max(0, remainingMs(timer, Date.now(), player.whole, player.rate)) : null;

  // ---- media session and keyboard
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: r.title, artist: r.authors.join(", "), album: r.narrators.length ? `Narrated by ${r.narrators.join(", ")}` : "",
      artwork: r.artwork.coverPath ? [{ src: r.artwork.coverPath }] : [] });
    ms.setActionHandler("play", () => void player.play());
    ms.setActionHandler("pause", () => player.pause());
    ms.setActionHandler("seekbackward", () => player.skip(-30_000));
    ms.setActionHandler("seekforward", () => player.skip(30_000));
    ms.setActionHandler("previoustrack", hasChapters ? prevChapter : null);
    ms.setActionHandler("nexttrack", canNext ? nextChapter : null);
    return () => { for (const a of ["play", "pause", "seekbackward", "seekforward", "previoustrack", "nexttrack"] as const) ms.setActionHandler(a, null); };
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target !== document.body) return;
      if (e.code === "Space") { e.preventDefault(); player.toggle(); }
      if (e.code === "ArrowLeft") player.skip(-10_000);
      if (e.code === "ArrowRight") player.skip(10_000);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  async function adopt(choice: "keep_server" | "use_candidate") {
    try {
      setResolveError(null);
      const res = await sync.resolve(choice, sync.conflict!.conflictId, sync.conflict!.server.revision);
      if (choice === "keep_server" && res.position && res.position.layoutRevision === r.layoutRevision) player.restore(res.position.fileId, res.position.contentVersion, res.position.offsetMs);
    } catch (e) { setResolveError(e); }
  }
  async function useCandidate(c: AudioPositionState["unresolvedConflicts"][number]) {
    try {
      setResolveError(null);
      const res = await api<AudioPositionState>("POST", `/recordings/${r.id}/conflicts/${c.id}/resolve`, {
        operationId: crypto.randomUUID(), baseRevision: initial.revision, layoutRevision: r.layoutRevision, choice: "use_candidate", position: null });
      sync.setRevision(res.revision);
      if (res.position) player.restore(res.position.fileId, res.position.contentVersion, res.position.offsetMs);
      setChosen(true);
    } catch (e) { setResolveError(e); }
  }

  return {
    recording: r, initial, ready, player, sync, pend, total, offsets, chapters, chapter, hasChapters, canNext, prevChapter, nextChapter,
    shown: scrub ?? player.whole, setScrub, commitScrub: (v: number) => { setScrub(null); player.seekWhole(v); },
    candidates, chosen, resolveError, adopt, useCandidate,
    sleep: { choice, left: sleepLeft, set: setSleep },
    /** Something needs the listener's attention, so the minimized player says so. */
    attention: !!player.error || !!sync.conflict || !!sync.changed,
  };
}
