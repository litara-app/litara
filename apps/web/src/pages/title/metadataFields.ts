export type FieldKind = "text" | "list" | "number" | "integer" | "multiline";
/** `only` limits a field to ebook editions or audiobook recordings; fields without it apply to both. */
export const FIELDS: { field: string; label: string; kind: FieldKind; hint?: string; only?: "edition" | "recording" }[] = [
  { field: "title", label: "Title", kind: "text" },
  { field: "authors", label: "Authors", kind: "list" },
  { field: "series_name", label: "Series", kind: "text" },
  { field: "series_index", label: "Series number", kind: "number" },
  { field: "narrators", label: "Narrators", kind: "list", only: "recording" },
  { field: "language", label: "Language", kind: "text", only: "edition" },
  { field: "tags", label: "Tags", kind: "list", only: "edition" },
  { field: "publisher", label: "Publisher", kind: "text" },
  { field: "published", label: "Published", kind: "text", hint: "A year, year-month or full date: 1895, 1895-05 or 1895-05-07." },
  { field: "page_count", label: "Pages", kind: "integer", only: "edition" },
  { field: "isbn", label: "ISBN", kind: "text", hint: "10 or 13 characters without hyphens." },
  { field: "description", label: "Synopsis", kind: "multiline" },
];

export function show(v: unknown): string {
  if (v === null || v === undefined) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

export function parseValue(field: string, text: string): unknown {
  const f = FIELDS.find((x) => x.field === field);
  if (f?.kind === "list") return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (f?.kind === "number" || f?.kind === "integer") return Number(text);
  return text;
}
