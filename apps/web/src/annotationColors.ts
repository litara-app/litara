import type { AnnotationData } from "./api/types";

/**
 * Highlight colours (ADR-0094). Only the name is stored; each client picks the shade it draws. Absent means the default
 * look: yellow for a highlight, blue for a note, as the reader frame draws them.
 */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const COLOR_LABEL: Record<HighlightColor, string> = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink", orange: "Orange" };

const ON_LIGHT: Record<HighlightColor, string> = { yellow: "#facc15", green: "#4ade80", blue: "#38bdf8", pink: "#f472b6", orange: "#fb923c" };
// Deeper shades, so light text on a dark page stays readable over the highlight.
const ON_DARK: Record<HighlightColor, string> = { yellow: "#ca8a04", green: "#15803d", blue: "#0369a1", pink: "#be185d", orange: "#c2410c" };

/** A stored name this version does not know is drawn with the default look. */
export const knownColor = (name: string | null | undefined): HighlightColor | undefined =>
  HIGHLIGHT_COLORS.find((c) => c === name);

/** The shade to draw for a stored name on the reader's theme, or undefined for the default look. */
export function shadeFor(name: string | null | undefined, theme: "light" | "sepia" | "dark" = "light"): string | undefined {
  const c = knownColor(name);
  return c && (theme === "dark" ? ON_DARK : ON_LIGHT)[c];
}

/** Whether this annotation can carry a colour: a highlight, or a note attached to selected text. */
export const takesColor = (d: Pick<AnnotationData, "kind" | "selection">) => d.kind !== "bookmark" && !!d.selection;

/** The same data with the colour set, or with the field removed for the default look. */
export function withColor<T extends { color?: string }>(data: T, color: HighlightColor | undefined): T {
  const next = { ...data } as T & { color?: string };
  if (color) next.color = color;
  else delete next.color;
  return next;
}
