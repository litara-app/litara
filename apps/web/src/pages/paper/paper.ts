import type { CopyDetails, NewPaperTitle, PhysicalCopy } from "../../api/types";

/* Physical books (ADR-0116): the form state shared by adding and editing a copy. */

export const BINDINGS = [
  { value: "hardcover", label: "Hardcover" },
  { value: "paperback", label: "Paperback" },
  { value: "other", label: "Other" },
];
export const bindingLabel = (v: string | null | undefined) => BINDINGS.find((b) => b.value === v)?.label ?? "Paper copy";

export interface CopyForm {
  binding: string | null; isbn: string; language: string; pageCount: number | null; location: string; note: string; acquiredOn: string | null;
}
export const emptyCopy: CopyForm = { binding: null, isbn: "", language: "", pageCount: null, location: "", note: "", acquiredOn: null };

export const copyForm = (c: PhysicalCopy): CopyForm => ({
  binding: c.binding ?? null, isbn: c.isbn ?? "", language: c.language ?? "", pageCount: c.pageCount ?? null,
  location: c.location ?? "", note: c.note ?? "", acquiredOn: c.acquiredOn ?? null,
});

/** Only what was filled in; a replacement of a copy clears what is left out. */
export function copyDetails(f: CopyForm): CopyDetails {
  const text = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    binding: (f.binding ?? undefined) as CopyDetails["binding"], isbn: text(f.isbn), language: text(f.language), pageCount: f.pageCount ?? undefined,
    location: text(f.location), note: text(f.note), acquiredOn: f.acquiredOn ?? undefined,
  };
}

export interface BookForm { title: string; authors: string; series: string; seriesIndex: number | null; publisher: string; published: string; description: string }
export const emptyBook: BookForm = { title: "", authors: "", series: "", seriesIndex: null, publisher: "", published: "", description: "" };

export const authorList = (v: string) => v.split(/[\n;,]/).map((s) => s.trim()).filter(Boolean);

export function newTitle(f: BookForm): NewPaperTitle {
  const text = (v: string) => (v.trim() ? v.trim() : undefined);
  const authors = authorList(f.authors);
  return {
    title: f.title.trim(), authors: authors.length ? authors : undefined, series: text(f.series), seriesIndex: f.seriesIndex ?? undefined,
    publisher: text(f.publisher), published: text(f.published), description: text(f.description),
  } as NewPaperTitle;
}

/** The same operation ID for the same request, so sending it again after a lost reply does nothing twice. */
export function operationIds() {
  let last = { body: "", id: "" };
  return (body: unknown) => {
    const key = JSON.stringify(body);
    if (key !== last.body) last = { body: key, id: crypto.randomUUID() };
    return last.id;
  };
}

/** What a person fills into the form from one provider result. */
export function fromCandidate(fields: Record<string, unknown>): { book: Partial<BookForm>; copy: Partial<CopyForm> } {
  const s = (k: string) => (typeof fields[k] === "string" ? (fields[k] as string) : undefined);
  const n = (k: string) => (typeof fields[k] === "number" ? (fields[k] as number) : undefined);
  const book: Partial<BookForm> = {};
  const copy: Partial<CopyForm> = {};
  if (s("title")) book.title = s("title");
  if (Array.isArray(fields.authors)) book.authors = (fields.authors as string[]).join(", ");
  if (s("series_name")) book.series = s("series_name");
  if (n("series_index") !== undefined) book.seriesIndex = n("series_index")!;
  if (s("publisher")) book.publisher = s("publisher");
  if (s("published")) book.published = s("published");
  if (s("description")) book.description = s("description")!.slice(0, 8000);
  if (s("language")) copy.language = s("language");
  if (n("page_count") !== undefined) copy.pageCount = n("page_count")!;
  return { book, copy };
}
