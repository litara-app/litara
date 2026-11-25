import { useEffect, useState } from "react";
import { icons, IconButton } from "../ui";

export type ToolbarMode = "auto" | "always";
const TOOLBAR_KEY = "litara.reader.toolbar";

/** Automated browsers keep the toolbar up so scripted clicks always find it. */
function loadToolbar(): ToolbarMode {
  try { const v = localStorage.getItem(TOOLBAR_KEY); if (v === "auto" || v === "always") return v; } catch { /* storage unavailable */ }
  return typeof navigator !== "undefined" && navigator.webdriver ? "always" : "auto";
}

/**
 * The toolbar of the Quiet page layout: it hides after a few idle seconds while reading and comes back on a move to the
 * top edge, a tap there, Escape, or focus inside it. `hold` keeps it up (a panel or editor is open).
 */
export function useQuietBar(hold: boolean) {
  const [toolbar, setToolbar] = useState<ToolbarMode>(loadToolbar);
  const [barOn, setBarOn] = useState(true);
  const [held, setHeld] = useState(false);
  const [tick, setTick] = useState(0);
  const reveal = () => { setBarOn(true); setTick((n) => n + 1); };
  const keep = toolbar === "always" || hold || held;
  useEffect(() => {
    if (keep) { setBarOn(true); return; }
    const t = setTimeout(() => setBarOn(false), 3500);
    return () => clearTimeout(t);
  }, [keep, tick]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { setBarOn(true); setTick((n) => n + 1); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const changeToolbar = (m: ToolbarMode) => { setToolbar(m); try { localStorage.setItem(TOOLBAR_KEY, m); } catch { /* optional */ } };
  const barProps = {
    onMouseEnter: () => setHeld(true), onMouseLeave: () => { setHeld(false); setTick((n) => n + 1); },
    onFocusCapture: () => setHeld(true), onBlurCapture: () => { setHeld(false); setTick((n) => n + 1); },
  };
  return { toolbar, changeToolbar, barOn, reveal, barProps };
}

/** The strip along the top edge that brings the toolbar back, and a small handle for touch and keyboard. */
export function QuietReveal({ barOn, reveal }: { barOn: boolean; reveal: () => void }) {
  return (
    <>
      <div className="lt-reader-reveal" aria-hidden="true" onMouseEnter={reveal} onClick={reveal} />
      {!barOn && <div className="lt-reader-handle"><IconButton variant="subtle" aria-label="Show toolbar" onClick={reveal}>{icons.chevDown}</IconButton></div>}
    </>
  );
}
