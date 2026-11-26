import { useQuery } from "@tanstack/react-query";
import { get } from "../../api/client";
import type { Library, Page } from "../../api/types";

/** The libraries a library rule can choose from: those the signed-in user can see. */
export function useLibraries(): Library[] {
  const q = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200") });
  return q.data?.items ?? [];
}
