import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CleanBg, SceneChoice } from "./scenes";

export type ThemeName = "reading-room" | "clean";
export const THEMES: { value: ThemeName; label: string; description: string }[] = [
  { value: "reading-room", label: "Reading Room", description: "Leather bindings, paper pages and old-book type. The default." },
  { value: "clean", label: "Clean", description: "A plain, compact interface with system fonts and no decoration." },
];

const KEY = "litara.theme";
const SCENE_KEY = "litara.scene";
const MODE_KEY = "litara.mode";
export type ColorMode = "light" | "dark";
function readMode(): ColorMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* follow the system */ }
  return null;
}
const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
const CLEAN_KEY = "litara.cleanBg";
function readClean(): CleanBg {
  try {
    const v = localStorage.getItem(CLEAN_KEY);
    if (v === "gradient" || v === "dots" || v === "shelves" || v === "marble") return v;
  } catch { /* default */ }
  return "gradient";
}
function read(): ThemeName {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "clean" || v === "reading-room") return v;
  } catch { /* storage unavailable: default theme */ }
  return "reading-room";
}

function readScene(): SceneChoice {
  try {
    const v = localStorage.getItem(SCENE_KEY);
    if (v === "marble" || v === "library" || v === "shelves" || v === "random") return v;
  } catch { /* default */ }
  return "random";
}

interface Ctx { theme: ThemeName; setTheme: (t: ThemeName) => void; scene: SceneChoice; setScene: (s: SceneChoice) => void; cleanBg: CleanBg; setCleanBg: (b: CleanBg) => void; mode: ColorMode; toggleMode: () => void }
const ThemeCtx = createContext<Ctx>({ theme: "reading-room", setTheme: () => {}, scene: "random", setScene: () => {}, cleanBg: "gradient", setCleanBg: () => {}, mode: "light", toggleMode: () => {} });
export const useTheme = () => useContext(ThemeCtx);

/**
 * The look is a per-browser choice for now: it is stored in this browser only, so it does not follow the account to
 * another device. Syncing it needs a server-side preference, which does not exist yet.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, set] = useState<ThemeName>(read);
  const [scene, setSceneState] = useState<SceneChoice>(readScene);
  const [cleanBg, setCleanBgState] = useState<CleanBg>(readClean);
  const [forced, setForced] = useState<ColorMode | null>(readMode);
  const [sysDark, setSysDark] = useState(systemDark);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysDark(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  useEffect(() => {
    if (forced) document.documentElement.dataset.mode = forced;
    else delete document.documentElement.dataset.mode;
  }, [forced]);
  const mode: ColorMode = forced ?? (sysDark ? "dark" : "light");
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const value = useMemo<Ctx>(() => ({
    theme,
    setTheme: (t) => {
      set(t);
      try { localStorage.setItem(KEY, t); } catch { /* the choice just is not remembered */ }
    },
    scene,
    setScene: (s) => {
      setSceneState(s);
      try { localStorage.setItem(SCENE_KEY, s); } catch { /* the choice just is not remembered */ }
    },
    cleanBg,
    setCleanBg: (b) => {
      setCleanBgState(b);
      try { localStorage.setItem(CLEAN_KEY, b); } catch { /* the choice just is not remembered */ }
    },
    mode,
    toggleMode: () => {
      const next: ColorMode = mode === "dark" ? "light" : "dark";
      setForced(next);
      try { localStorage.setItem(MODE_KEY, next); } catch { /* the choice just is not remembered */ }
    },
  }), [theme, scene, cleanBg, mode]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
