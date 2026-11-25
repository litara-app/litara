import type { MetadataField, ProviderCandidate } from "../../api/types";
import { FIELDS, show, type FieldKind } from "./metadataFields";

/** What one field of a provider's result looks like next to what is stored. */
export interface ReviewRow {
  field: string; label: string; kind: FieldKind;
  current: string; currentRaw: unknown; source: string | null;
  offered: unknown; offeredText: string;
  /** The stored value and the offered one are the same, so there is nothing to choose. */
  same: boolean;
  /** An edit of the person's own, which only an explicit choice may replace. */
  protectedEdit: boolean;
  /** The person locked the field, so nothing may replace it until it is unlocked (ADR-0097). */
  locked: boolean;
  /** Nothing (or only a file name) is stored, so using the offered value is the sensible default. */
  preselected: boolean;
}

/** What is done with a field when the review is applied. Lists can be merged; everything else is kept or used. */
export type Action = "keep" | "use" | "merge" | "replace";

/**
 * Every field the candidate offers, with what is stored beside it. A field is preselected only when nothing is stored
 * for it (or only the file name); an edit, a deliberate clear, or a value from the files is never preselected, so a
 * provider cannot replace it without a person choosing to (ADR-0047/0060).
 */
export function reviewFields(report: { fields: MetadataField[] }, candidate: ProviderCandidate): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const d of FIELDS) {
    if (!(d.field in candidate.fields)) continue;
    const offered = candidate.fields[d.field];
    if (offered === null || offered === undefined) continue;
    const offeredText = show(offered);
    if (offeredText === "") continue;
    const cur = report.fields.find((f) => f.field === d.field);
    const current = cur && !cur.cleared ? show(cur.value) : "";
    rows.push({
      field: d.field, label: d.label, kind: d.kind,
      current: cur?.cleared ? "Deliberately empty" : current, currentRaw: cur && !cur.cleared ? cur.value : null, source: cur?.source ?? null,
      offered, offeredText, same: !!cur && !cur.cleared && current === offeredText,
      protectedEdit: cur?.source === "user", locked: !!cur?.locked, preselected: !cur || cur.source === "filename",
    });
  }
  return rows;
}

/** The rows that differ, which is what a review is for. */
export function reviewRows(report: { fields: MetadataField[] }, candidate: ProviderCandidate): ReviewRow[] {
  return reviewFields(report, candidate).filter((r) => !r.same);
}

/** The default choice for a row: use what is offered where there was a gap, otherwise keep what is stored. */
export const defaultAction = (r: ReviewRow): Action => (!r.same && !r.locked && r.preselected ? (r.kind === "list" ? "merge" : "use") : "keep");

/** The value to store for a row under an action. Merging keeps the stored items first and adds the new ones. */
export function valueFor(r: ReviewRow, action: Action): unknown {
  if (action !== "merge") return r.offered;
  const have = Array.isArray(r.currentRaw) ? (r.currentRaw as unknown[]).map(String) : [];
  const add = (Array.isArray(r.offered) ? (r.offered as unknown[]) : [r.offered]).map(String);
  const seen = new Set(have.map((s) => s.toLowerCase()));
  return [...have, ...add.filter((s) => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))];
}
