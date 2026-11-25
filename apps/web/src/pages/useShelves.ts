import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, get, op } from "../api/client";
import type { Page as Paged, Shelf } from "../api/types";

/** The shelves this person can add titles to, and the action that adds one. Shared by every list and title screen. */
export function useShelfActions() {
  const qc = useQueryClient();
  const shelves = useQuery({ queryKey: ["shelves", "mine"], queryFn: () => get<Paged<Shelf>>("/shelves?scope=mine&size=200") });
  const add = useMutation({
    mutationFn: ({ shelf, titleId }: { shelf: Shelf; titleId: string }) => api<Shelf>("PUT", `/shelves/${shelf.id}/titles/${titleId}`, op(shelf.revision)),
    meta: { success: (_d: unknown, v: { shelf: Shelf }) => `Added to ${v.shelf.data?.name ?? "the shelf"}` },
    onSettled: () => qc.invalidateQueries({ queryKey: ["shelves"] }),
  });
  const manual = (shelves.data?.items ?? []).filter((s) => !s.deleted && s.canEdit && s.data?.kind === "manual");
  return { shelves: manual, add: (shelf: Shelf, titleId: string) => add.mutate({ shelf, titleId }), error: add.error, pending: add.isPending };
}
