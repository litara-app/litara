import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminOp, API, api, ApiError, get, qs, uploadFile } from "../../api/client";
import type { FieldChange } from "../title/metadataSave";

/* Shared author and series details (ADR-0102 to ADR-0105). */

export type DirectoryKind = "author" | "series";

export interface DirectoryField {
  field: string;
  source: "user" | "guessed" | "none";
  value: string | number | null;
  cleared: boolean;
  locked: boolean;
}
export interface AuthorPhotoInfo { source: "upload" | "url" | "none"; version: string | null; locked: boolean }
export interface DirectoryDetails { name: string; revision: string; fields: DirectoryField[]; photo?: AuthorPhotoInfo }

const base = (kind: DirectoryKind) => (kind === "author" ? "/authors" : "/series");
const detailsKey = (kind: DirectoryKind, name: string) => ["directory-details", kind, name.toLowerCase()];

/** Where an author's photo is. The version makes the browser load a new photo as soon as it is stored. */
export const authorPhotoPath = (name: string, version: string) => `${API}/authors/photo${qs({ name, v: version })}`;

export function useDirectoryDetails(kind: DirectoryKind, name: string, enabled = true) {
  return useQuery({ queryKey: detailsKey(kind, name), enabled, queryFn: () => get<DirectoryDetails>(`${base(kind)}/details${qs({ name })}`) });
}

/** A field's value as text, or nothing when it has none. */
export function fieldText(details: DirectoryDetails | undefined, field: string): string {
  const value = details?.fields.find((f) => f.field === field)?.value;
  return value === null || value === undefined ? "" : String(value);
}

export type DirectoryEdit =
  | { kind: "changes"; changes: FieldChange[]; note?: string }
  | { kind: "upload"; file: File; note: string }
  | { kind: "url"; url: string; note: string };

/**
 * One edit against the revision on screen (ADR-0105). The fields and the photo share that revision, so only one edit of
 * an author or series is in flight at a time. A conflict refetches, so the next try starts from what is saved.
 */
export function useDirectoryEdit(kind: DirectoryKind, name: string) {
  const qc = useQueryClient();
  const key = detailsKey(kind, name);
  const mutationKey = ["directory-edit", kind, name.toLowerCase()];
  const save = useMutation({
    mutationKey,
    mutationFn: (e: DirectoryEdit) => {
      const operation = adminOp(qc.getQueryData<DirectoryDetails>(key)!.revision);
      if (e.kind === "upload") return uploadFile<DirectoryDetails>("PUT", `/authors/photo${qs({ name, ...operation })}`, e.file);
      if (e.kind === "url") return api<DirectoryDetails>("POST", `/authors/photo/from-url${qs({ name })}`, { ...operation, url: e.url });
      return api<DirectoryDetails>("PATCH", `${base(kind)}/details${qs({ name })}`, {
        ...operation, changes: e.changes.map((c) => (c.action === "set" && c.clear ? { field: c.field, action: "set", clear: true } : c)),
      });
    },
    meta: { success: (_d: unknown, e: DirectoryEdit) => e.note },
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      // A last name moves an author in the directory, and a photo changes their card.
      void qc.invalidateQueries({ queryKey: ["directory"] });
    },
    onError: (error) => { if (error instanceof ApiError && error.status === 409) void qc.invalidateQueries({ queryKey: key }); },
  });
  const busy = useIsMutating({ mutationKey }) > 0;
  const conflict = save.error instanceof ApiError && (save.error.code === "stale_revision" || save.error.code === "field_locked");
  return { save, busy, conflict };
}
