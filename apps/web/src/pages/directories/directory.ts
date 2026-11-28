import { api } from "../../api/client";
import type { Page as Paged, TitleRow } from "../../api/types";
import { formatLabel } from "../../ui";

const SIZE = 200;
const MAX_PAGES = 5;

/**
 * Every title the viewer can see whose author or series is `name`, ignoring case (ADR-0100), through the title search's
 * "is" filter: the same rule the Library uses, so the directory and a Library filter always agree.
 */
export async function titlesBy(field: "author" | "series", name: string, sort = field === "series" ? "series_index" : "title"): Promise<TitleRow[]> {
  const out: TitleRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const p = await api<Paged<TitleRow>>("POST", "/titles/search", {
      filter: { type: "rule", field, operator: "is", value: [name] }, sort, order: "asc", page, size: SIZE,
    });
    out.push(...p.items);
    if (out.length >= p.total || p.items.length === 0) break;
  }
  return out;
}

/** Book number in a series: "#2", "#2.5", or nothing when it has no number. */
export const bookNumber = (n: number | null) => (n === null || n === undefined ? "" : `#${Number.isInteger(n) ? n : n.toString()}`);

/** Whole numbers between the first and last book of a series that no book has (ADR-0100). */
export function missingNumbers(indexes: (number | null)[]): number[] {
  const whole = new Set(indexes.filter((n): n is number => n !== null && n !== undefined).map((n) => Math.floor(n)));
  const present = indexes.filter((n): n is number => n !== null && n !== undefined);
  if (present.length === 0) return [];
  const lo = Math.floor(Math.min(...present)), hi = Math.floor(Math.max(...present));
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) if (!whole.has(n)) out.push(n);
  return out;
}

/** In series order: numbered books by number, then unnumbered ones by title. */
export function bySeriesOrder(a: TitleRow, b: TitleRow): number {
  const x = a.seriesIndex ?? Infinity, y = b.seriesIndex ?? Infinity;
  return x !== y ? x - y : a.title.localeCompare(b.title);
}

/** An author's books grouped by series (series by name), each in series order, then the books in no series by title. */
export function groupBySeries(rows: TitleRow[]): { series: string | null; titles: TitleRow[] }[] {
  const groups = new Map<string, { series: string; titles: TitleRow[] }>();
  const loose: TitleRow[] = [];
  for (const t of rows) {
    const s = t.series[0]?.trim();
    if (!s) { loose.push(t); continue; }
    const k = s.toLowerCase();
    const g = groups.get(k) ?? { series: s, titles: [] };
    g.titles.push(t);
    groups.set(k, g);
  }
  const out: { series: string | null; titles: TitleRow[] }[] = [...groups.values()]
    .sort((a, b) => a.series.localeCompare(b.series, undefined, { sensitivity: "base" }))
    .map((g) => ({ series: g.series, titles: g.titles.sort(bySeriesOrder) }));
  if (loose.length) out.push({ series: null, titles: loose.sort((a, b) => a.title.localeCompare(b.title)) });
  return out;
}

export const authorPath = (name: string) => `/authors/${encodeURIComponent(name)}`;
export const seriesPath = (name: string) => `/series/${encodeURIComponent(name)}`;

/** The cover medium to show for a title. Paper uses the book-shaped ebook cover (ADR-0116). */
export const coverMedium = (t: { editionCount: number; recordingCount: number }) => (t.editionCount === 0 && t.recordingCount > 0 ? "audio" : "ebook") as "ebook" | "audio";

/** A short line under a book cover: its formats. */
export const formatsLine = (t: TitleRow) => [formatLabel(t.formats.filter((f) => f !== "audio" && f !== "paper")), t.recordingCount > 0 ? "Audiobook" : null,
  t.physicalCopyCount > 0 ? "Paper" : null].filter(Boolean).join(" · ");
