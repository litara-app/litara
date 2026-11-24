import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, get } from "../../api/client";
import type { PersonalData, TitlePersonal } from "../../api/types";

/** The caller's private rating, review and date overrides for a title, and a write that keeps the revision straight. */
export function usePersonal(titleId: string) {
  const qc = useQueryClient();
  const key = ["title", titleId, "personal"];
  const q = useQuery({ queryKey: key, queryFn: () => get<TitlePersonal>(`/titles/${titleId}/personal`) });
  const save = useMutation({
    mutationFn: (patch: Partial<PersonalData>) => {
      const cur = q.data!;
      return api<TitlePersonal>("PUT", `/titles/${titleId}/personal`, {
        operationId: crypto.randomUUID(), baseRevision: cur.revision, capturedAt: new Date().toISOString(), data: { ...cur.data, ...patch },
      });
    },
    meta: { success: (_d: unknown, v: Partial<PersonalData>) => ("ratingHalves" in v ? (v.ratingHalves == null ? "Rating cleared" : `Rated ${v.ratingHalves / 2} of 5`) : "Saved") },
    onSuccess: (p) => qc.setQueryData(key, p),
    // A stale revision means another device changed it first; show what the server has and let the person try again.
    onError: (e) => { if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: key }); },
  });
  return { data: q.data, loading: q.isPending, error: q.error, save, ready: !!q.data };
}
