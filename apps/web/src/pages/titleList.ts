import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, get, qs } from "../api/client";
import type { Page as Paged, TitleRow } from "../api/types";
import type { WireFilter } from "./filter/filterTree";

/** Page size of the library list; the title page's previous/next navigation reads the same pages. */
export const LIST_SIZE = 24;

/** What the library list was showing, so a title opened from it can step to its neighbours in that same list. */
export interface ListContext { q: string; libraryId: string; mediaKind: string; sort: string; order: string; applied: WireFilter | null }

const STORE = "litara.titleList";
export const DEFAULT_LIST: ListContext = { q: "", libraryId: "", mediaKind: "", sort: "title", order: "asc", applied: null };

export const listKey = (c: ListContext) => ["titles", c.q, c.libraryId, c.mediaKind, c.sort, c.order, c.applied] as const;

export function fetchListPage(c: ListContext, page: number): Promise<Paged<TitleRow>> {
  return c.applied
    ? api<Paged<TitleRow>>("POST", "/titles/search", { filter: c.applied, q: c.q || undefined, libraryId: c.libraryId || undefined, mediaKind: c.mediaKind || undefined, sort: c.sort, order: c.order, page, size: LIST_SIZE })
    : get<Paged<TitleRow>>(`/titles${qs({ q: c.q, libraryId: c.libraryId, mediaKind: c.mediaKind, sort: c.sort, order: c.order, page, size: LIST_SIZE })}`);
}

export function rememberList(c: ListContext) {
  try { sessionStorage.setItem(STORE, JSON.stringify(c)); } catch { /* storage can be unavailable; navigation then uses the default order */ }
}

function recalledList(): ListContext {
  try {
    const raw = sessionStorage.getItem(STORE);
    if (raw) return { ...DEFAULT_LIST, ...(JSON.parse(raw) as Partial<ListContext>) };
  } catch { /* fall through to the default */ }
  return DEFAULT_LIST;
}

const MAX_PAGES = 200;

/** Position of a title in the list it was opened from, with the ids on either side. Loads further pages only as far as needed. */
export function useNeighbours(titleId: string) {
  const ctx = recalledList();
  const list = useInfiniteQuery({
    queryKey: listKey(ctx), initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchListPage(ctx, pageParam),
    getNextPageParam: (last, all) => (all.length < MAX_PAGES && all.length * LIST_SIZE < last.total ? all.length : undefined),
    staleTime: 30_000,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const index = items.findIndex((t) => t.id === titleId);
  const total = list.data?.pages[0]?.total ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  // Keep loading until this title and the one after it are known.
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    if (index < 0 || index === items.length - 1) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, index, items.length]);
  if (index < 0) return null;
  return { position: index + 1, total, prev: items[index - 1]?.id ?? null, next: items[index + 1]?.id ?? null };
}
