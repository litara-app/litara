export type FieldKind = "text" | "list" | "number" | "integer" | "multiline";
export type FieldGroup = "Description" | "Publishing" | "Series" | "Classification" | "Identifiers" | "Public ratings";

/** `only` limits a field to ebook editions or audiobook recordings; fields without it apply to both. */
export interface FieldDef { field: string; label: string; kind: FieldKind; group: FieldGroup; hint?: string; only?: "edition" | "recording" }

export const GROUPS: FieldGroup[] = ["Description", "Publishing", "Series", "Classification", "Identifiers", "Public ratings"];

export const FIELDS: FieldDef[] = [
  { field: "title", label: "Title", kind: "text", group: "Description" },
  { field: "subtitle", label: "Subtitle", kind: "text", group: "Description", only: "edition" },
  { field: "authors", label: "Authors", kind: "list", group: "Description" },
  { field: "narrators", label: "Narrators", kind: "list", group: "Description", only: "recording" },
  { field: "description", label: "Description", kind: "multiline", group: "Description" },

  { field: "publisher", label: "Publisher", kind: "text", group: "Publishing" },
  { field: "published", label: "Published", kind: "text", group: "Publishing", hint: "A year, year-month or full date: 1895, 1895-05 or 1895-05-07." },
  { field: "language", label: "Language", kind: "text", group: "Publishing", only: "edition" },
  { field: "page_count", label: "Pages", kind: "integer", group: "Publishing", only: "edition" },

  { field: "series_name", label: "Series", kind: "text", group: "Series" },
  { field: "series_index", label: "Series number", kind: "number", group: "Series" },

  { field: "genres", label: "Genres", kind: "list", group: "Classification", only: "edition" },
  { field: "tags", label: "Tags", kind: "list", group: "Classification", only: "edition" },
  { field: "moods", label: "Moods", kind: "list", group: "Classification", only: "edition" },
  { field: "age_rating", label: "Age rating", kind: "text", group: "Classification", only: "edition", hint: "For example: Everyone, Teen, Mature." },

  { field: "isbn", label: "ISBN", kind: "text", group: "Identifiers", hint: "10 or 13 characters without hyphens." },
  { field: "asin", label: "ASIN", kind: "text", group: "Identifiers", only: "edition", hint: "10 letters or digits." },
  { field: "open_library_id", label: "Open Library ID", kind: "text", group: "Identifiers", only: "edition", hint: "The work id, for example OL262758W." },
  { field: "google_books_id", label: "Google Books ID", kind: "text", group: "Identifiers", only: "edition" },
  { field: "hardcover_id", label: "Hardcover ID", kind: "text", group: "Identifiers", only: "edition" },
  { field: "goodreads_id", label: "Goodreads ID", kind: "text", group: "Identifiers", only: "edition" },

  { field: "public_rating", label: "Average rating", kind: "number", group: "Public ratings", only: "edition", hint: "From 0 to 5. This is other readers' rating, not yours." },
  { field: "public_rating_count", label: "Number of ratings", kind: "integer", group: "Public ratings", only: "edition" },
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
