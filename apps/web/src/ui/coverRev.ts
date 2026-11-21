import { useSyncExternalStore } from "react";

/**
 * A counter that changes whenever a cover is replaced. Covers are served with `no-cache` and an ETag, but an image that is
 * already on screen is not refetched on its own, so each cover URL carries this number and changes with it.
 */
let rev = 0;
const listeners = new Set<() => void>();

export function bumpCovers() {
  rev += 1;
  listeners.forEach((l) => l());
}

export function useCoverRev(): number {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => rev, () => 0);
}
