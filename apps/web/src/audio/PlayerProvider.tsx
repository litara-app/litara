import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { get } from "../api/client";
import type { AudioPositionState, AudioRecording } from "../api/types";
import { Button, Text, icons } from "../ui";
import { FullPlayer } from "./FullPlayer";
import { MiniPlayer } from "./MiniPlayer";
import { usePlayerController } from "./usePlayerController";

export interface StartOptions {
  /** Begin playing as soon as the recording is ready. Default true. */
  autoplay?: boolean;
  /** Open the full-screen player instead of the minimized one. Default false. */
  expand?: boolean;
}

interface PlayerApi {
  activeId: string | null;
  expanded: boolean;
  start: (recordingId: string, opts?: StartOptions) => void;
  setExpanded: (open: boolean) => void;
  close: () => void;
  /** Where the minimized player is drawn (set by the shell). */
  setSlot: (el: HTMLElement | null) => void;
}

/** Outside a provider (a screen rendered on its own) the player does nothing rather than failing. */
const none: PlayerApi = { activeId: null, expanded: false, start: () => undefined, setExpanded: () => undefined, close: () => undefined, setSlot: () => undefined };
const Ctx = createContext<PlayerApi>(none);

export function usePlayer(): PlayerApi {
  return useContext(Ctx);
}

/**
 * Owns the one audio player for the whole app, so listening carries on while you browse. It is minimized by default (a bar
 * under the page, in the slot the shell provides) and can be opened full screen.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ id: string; autoplay: boolean; token: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const token = useRef(0);

  const start = useCallback((id: string, opts: StartOptions = {}) => {
    token.current += 1;
    setActive({ id, autoplay: opts.autoplay ?? true, token: token.current });
    setExpanded(opts.expand ?? false);
  }, []);
  const close = useCallback(() => { setActive(null); setExpanded(false); }, []);

  const api = useMemo<PlayerApi>(() => ({ activeId: active?.id ?? null, expanded, start, setExpanded, close, setSlot }), [active?.id, expanded, start, close]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {active && <ActivePlayer key={active.id} id={active.id} autoplay={active.autoplay} token={active.token} expanded={expanded} setExpanded={setExpanded} close={close} slot={slot} />}
    </Ctx.Provider>
  );
}

function ActivePlayer({ id, autoplay, token, expanded, setExpanded, close, slot }: {
  id: string; autoplay: boolean; token: number; expanded: boolean; setExpanded: (v: boolean) => void; close: () => void; slot: HTMLElement | null;
}) {
  const rec = useQuery({ queryKey: ["listen", id], queryFn: () => get<AudioRecording>(`/recordings/${id}`), staleTime: Infinity, gcTime: 0 });
  const pos = useQuery({ queryKey: ["listen-pos", id], queryFn: () => get<AudioPositionState>(`/recordings/${id}/position`), staleTime: Infinity, gcTime: 0 });
  const err = rec.error ?? pos.error;
  if (!slot) return null;
  if (err || rec.isPending || pos.isPending) {
    return createPortal(
      <aside className="lt-mini" aria-label="Audio player" data-testid="mini-player">
        <Text size="sm" tone={err ? "danger" : "dim"}>{err ? "This audiobook could not be opened." : "Opening audiobook…"}</Text>
        <span className="lt-grow" />
        <Button size="sm" icon={icons.close} onClick={close}>Close</Button>
      </aside>, slot);
  }
  return <Loaded recording={rec.data!} initial={pos.data!} autoplay={autoplay} token={token} expanded={expanded} setExpanded={setExpanded} close={close} slot={slot} />;
}

function Loaded({ recording, initial, autoplay, token, expanded, setExpanded, close, slot }: {
  recording: AudioRecording; initial: AudioPositionState; autoplay: boolean; token: number; expanded: boolean; setExpanded: (v: boolean) => void; close: () => void; slot: HTMLElement;
}) {
  const c = usePlayerController({ recording, initial, autoplay, token });
  // The page leaves room for the bar while it is showing.
  useEffect(() => {
    const app = slot.closest(".lt-app");
    app?.setAttribute("data-player", "");
    return () => app?.removeAttribute("data-player");
  }, [slot]);
  return (
    <>
      {createPortal(<MiniPlayer c={c} onExpand={() => setExpanded(true)} onClose={close} />, slot)}
      <FullPlayer c={c} open={expanded} onMinimize={() => setExpanded(false)} onClose={close} />
    </>
  );
}
