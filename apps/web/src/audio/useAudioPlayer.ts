import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioRecording } from "../api/types";
import { locate, toWhole } from "./timeline";
import { probeType } from "./mime";

export interface Checkpoint { fileId: string; contentVersion: string; offsetMs: number }

interface Opts {
  recording: AudioRecording;
  /** Saved or sent by the caller; called while playing, on pause, seek, hide and unmount. */
  onCheckpoint: (c: Checkpoint) => void;
  /** The last file finished playing. */
  onEnded: (final: Checkpoint) => void;
}

const CHECKPOINT_MS = 15_000;

/**
 * One HTMLAudioElement plays the recording's files in order. Whole-recording
 * time is derived from the server's per-file durations; every checkpoint is a
 * file/version/offset anchor, never a percentage or a clock.
 */
export function useAudioPlayer({ recording, onCheckpoint, onEnded }: Opts) {
  const files = recording.files;
  const timed = useMemo(() => files.map((f) => ({ id: f.id, durationMs: f.durationMs ?? 0 })), [files]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState(0);
  const [whole, setWhole] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);
  const indexRef = useRef(0);
  const wantPlay = useRef(false);
  const pendingOffset = useRef<number | null>(null);
  const lastCheckpoint = useRef(0);
  const cb = useRef({ onCheckpoint, onEnded });
  cb.current = { onCheckpoint, onEnded };

  const unsupported = useMemo(() => {
    const probe = document.createElement("audio");
    return files.filter((f) => f.mimeType && probe.canPlayType(probeType(f.mimeType)) === "").map((f) => f.filename);
  }, [files]);

  const anchor = useCallback((): Checkpoint => {
    const f = files[indexRef.current];
    return { fileId: f.id, contentVersion: f.contentVersion, offsetMs: Math.round((audio.current?.currentTime ?? 0) * 1000) };
  }, [files]);


  const load = useCallback((i: number, offsetMs: number, autoplay: boolean) => {
    const a = audio.current!;
    const f = files[i];
    indexRef.current = i;
    setIndex(i);
    setError(null);
    wantPlay.current = autoplay;
    if (a.dataset.fileId === f.id && a.dataset.version === f.contentVersion && a.readyState >= 1) {
      a.currentTime = offsetMs / 1000;
      setWhole(toWhole(timed, i, offsetMs));
      if (autoplay) void a.play().catch(() => undefined);
      return;
    }
    pendingOffset.current = offsetMs;
    a.dataset.fileId = f.id;
    a.dataset.version = f.contentVersion;
    a.src = f.contentPath;
    a.load();
  }, [files, timed]);

  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    audio.current = a;
    const onMeta = () => {
      if (pendingOffset.current !== null) { a.currentTime = pendingOffset.current / 1000; pendingOffset.current = null; }
      setWhole(toWhole(timed, indexRef.current, Math.round(a.currentTime * 1000)));
      if (wantPlay.current) void a.play().catch((e: Error) => fail(e));
    };
    const fail = (e?: Error) => {
      const code = a.error?.code;
      setPlaying(false);
      setError(code === 4 || e?.name === "NotSupportedError"
        ? "This browser cannot play this audio format."
        : e?.name === "NotAllowedError" ? "The browser blocked playback; press play again."
        : "The audio could not be played. Check your connection and try again.");
    };
    const onTime = () => {
      setWhole(toWhole(timed, indexRef.current, Math.round(a.currentTime * 1000)));
      if (!a.paused && Date.now() - lastCheckpoint.current > CHECKPOINT_MS) { lastCheckpoint.current = Date.now(); cb.current.onCheckpoint(anchor()); }
    };
    const onEnd = () => {
      const i = indexRef.current;
      if (i + 1 < files.length) { load(i + 1, 0, true); return; }
      wantPlay.current = false;
      setPlaying(false);
      const f = files[i];
      cb.current.onEnded({ fileId: f.id, contentVersion: f.contentVersion, offsetMs: f.durationMs ?? Math.round(a.duration * 1000) });
    };
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", () => setPlaying(true));
    a.addEventListener("pause", () => { setPlaying(false); if (!a.ended) cb.current.onCheckpoint(anchor()); });
    a.addEventListener("waiting", () => setBuffering(true));
    a.addEventListener("playing", () => setBuffering(false));
    a.addEventListener("canplay", () => setBuffering(false));
    a.addEventListener("error", () => fail());
    const hide = () => { if (document.visibilityState === "hidden" && a.src) cb.current.onCheckpoint(anchor()); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      if (a.src) cb.current.onCheckpoint(anchor());
      a.pause();
      a.removeAttribute("src");
      a.load();
      audio.current = null;
    };
    // The element lives as long as the recording snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording.id, recording.layoutRevision]);

  const seekWhole = useCallback((ms: number, autoplay = !audio.current?.paused) => {
    const t = locate(timed, ms);
    load(t.index, t.offsetMs, autoplay);
    if (!autoplay) setWhole(toWhole(timed, t.index, t.offsetMs));
    // Save the place being moved to, not what the element reports before it has loaded the new file.
    lastCheckpoint.current = Date.now();
    const f = files[t.index];
    cb.current.onCheckpoint({ fileId: f.id, contentVersion: f.contentVersion, offsetMs: t.offsetMs });
  }, [timed, files, load]);

  const play = useCallback(async () => {
    const a = audio.current;
    if (!a) return;
    if (!a.src) { load(indexRef.current, 0, true); return; }
    wantPlay.current = true;
    try { await a.play(); } catch (e) { setPlaying(false); setError((e as Error).name === "NotSupportedError" ? "This browser cannot play this audio format." : "The browser blocked playback; press play again."); }
  }, [load]);
  const pause = useCallback(() => { wantPlay.current = false; audio.current?.pause(); }, []);
  const toggle = useCallback(() => (audio.current?.paused ?? true ? void play() : pause()), [play, pause]);
  const skip = useCallback((deltaMs: number) => seekWhole(whole + deltaMs), [seekWhole, whole]);
  const setRate = useCallback((r: number) => { setRateState(r); if (audio.current) audio.current.playbackRate = r; }, []);
  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate, index]);

  /** Put the playhead at a saved anchor without starting playback. */
  const restore = useCallback((fileId: string, version: string, offsetMs: number): boolean => {
    const i = files.findIndex((f) => f.id === fileId && f.contentVersion === version);
    if (i < 0) return false;
    load(i, offsetMs, false);
    setWhole(toWhole(timed, i, offsetMs));
    return true;
  }, [files, load, timed]);

  return { index, whole, playing, rate, error, buffering, unsupported, play, pause, toggle, seekWhole, skip, setRate, restore, anchor };
}
