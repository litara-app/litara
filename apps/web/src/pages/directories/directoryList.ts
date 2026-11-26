import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { get, qs } from "../../api/client";
import type { Page as Paged } from "../../api/types";
import type { FanCover } from "../../ui";

export const DIRECTORY_SIZE = 60;

export interface DirectoryAuthor { name: string; titles: number; coverTitleId: string; seriesCount: number; lastName: string; photoVersion: string | null }
export interface DirectorySeries { name: string; titles: number; coverTitleId: string; authors: string[]; covers: FanCover[]; finished: number }

export type DirectoryPath = "/authors" | "/series";
/** What a directory was showing, so a page opened from it can step to its neighbours in that same list. */
export interface DirectoryContext { q: string; sort: string; letter: string }
/** Authors are listed by last name unless the viewer asks otherwise (ADR-0101); series by name. */
export const defaultSort = (path: DirectoryPath) => (path === "/authors" ? "last" : "name");

const store = (path: DirectoryPath) => `litara.directory${path}`;
const defaultContext = (path: DirectoryPath): DirectoryContext => ({ q: "", sort: defaultSort(path), letter: "" });

/** A directory page. `letters`, for authors, are the A to Z choices that have anyone under the current search and sort. */
export type DirectoryPage<T> = Paged<T> & { letters?: string[] };

export function useDirectory<T extends { name: string }>(path: DirectoryPath, ctx: DirectoryContext) {
  return useInfiniteQuery({
    queryKey: ["directory", path, ctx.q, ctx.sort, ctx.letter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => get<DirectoryPage<T>>(
      `${path}${qs({ q: ctx.q, sort: ctx.sort === defaultSort(path) ? "" : ctx.sort, letter: ctx.letter, page: pageParam, size: DIRECTORY_SIZE })}`),
    getNextPageParam: (last, all) => (all.length * DIRECTORY_SIZE < last.total ? all.length : undefined),
    staleTime: 30_000,
  });
}

export function rememberDirectory(path: DirectoryPath, ctx: DirectoryContext) {
  try { sessionStorage.setItem(store(path), JSON.stringify(ctx)); } catch { /* storage can be unavailable; the pager then uses the default order */ }
}

function recalledDirectory(path: DirectoryPath): DirectoryContext {
  try {
    const raw = sessionStorage.getItem(store(path));
    if (raw) return { ...defaultContext(path), ...(JSON.parse(raw) as Partial<DirectoryContext>) };
  } catch { /* fall through to the default */ }
  return defaultContext(path);
}

const MAX_PAGES = 100;

/** Position of an author or series in the list it was opened from, with the names on either side. */
export function useDirectoryNeighbours(path: DirectoryPath, name: string) {
  const list = useDirectory<{ name: string }>(path, recalledDirectory(path));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const index = items.findIndex((i) => i.name.toLowerCase() === name.toLowerCase());
  const total = list.data?.pages[0]?.total ?? 0;
  const pages = list.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  // Keep loading until this entry and the one after it are known.
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || pages >= MAX_PAGES) return;
    if (index < 0 || index === items.length - 1) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, index, items.length, pages]);
  if (index < 0) return null;
  return { position: index + 1, total, prev: items[index - 1]?.name ?? null, next: items[index + 1]?.name ?? null };
}
