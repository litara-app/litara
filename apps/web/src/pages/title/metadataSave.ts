import { adminOp, api } from "../../api/client";
import type { MetadataReport } from "../../api/types";

/** One field change of a metadata save (ADR-0095, ADR-0097). A locked field refuses set and reset until it is unlocked. */
export type FieldChange =
  | { field: string; action: "set"; clear: boolean; value?: unknown }
  | { field: string; action: "reset" | "lock" | "unlock" };

/** Saves every change together against the revision the form was loaded from; a change made since is a conflict and stores nothing. */
export const saveMetadata = (base: string, revision: string, changes: FieldChange[]) =>
  api<MetadataReport>("PATCH", base, { ...adminOp(revision), changes: changes.map((c) => (c.action === "set" && c.clear ? { field: c.field, action: "set", clear: true } : c)) });
