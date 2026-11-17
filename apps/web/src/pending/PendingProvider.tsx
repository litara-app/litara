import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { api, ApiError, get } from "../api/client";
import type { BrowserSession } from "../api/types";
import { useAuth } from "../auth/session";
import { PendingQueue, type QueueState } from "./queue";
import { defaultStore, type PendingOp } from "./store";

const Ctx = createContext<PendingQueue | null>(null);

export function usePendingQueue(): PendingQueue {
  const q = useContext(Ctx);
  if (!q) throw new Error("PendingProvider missing");
  return q;
}

export function usePendingState(): QueueState {
  const q = usePendingQueue();
  return useSyncExternalStore(q.subscribe, q.getState);
}

/** Pending writes for one edition (used to show unsaved items honestly). */
export function useEditionPending(editionId: string): PendingOp[] {
  const s = usePendingState();
  return useMemo(() => s.items.filter((o) => o.editionId === editionId), [s.items, editionId]);
}

let checkedAt = 0;
let checkedUser = "";

/** The cookie belongs to whoever is signed in now; never send one account's queue as another. */
async function sessionMatches(userId: string): Promise<boolean> {
  if (Date.now() - checkedAt < 3000) return checkedUser === userId;
  const s = await get<BrowserSession>("/auth/web/session");
  checkedAt = Date.now();
  checkedUser = s.user.id;
  return s.user.id === userId;
}

export function PendingProvider({ children, queue }: { children: ReactNode; queue?: PendingQueue }) {
  const { user, expire } = useAuth();
  const q = useMemo(() => queue ?? new PendingQueue(defaultStore(), async (op) => {
    const owner = op.scope.split("|")[1];
    if (!(await sessionMatches(owner))) {
      throw new ApiError(401, { code: "session_changed", detail: "A different account is signed in." });
    }
    return api(op.method, op.path, op.body);
  }), [queue]);

  // Bind the queue to the signed-in account; with none, it is locked.
  useEffect(() => { checkedAt = 0; checkedUser = ""; void q.setScope(user ? `${location.origin}|${user.id}` : null); }, [q, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retry when connectivity or visibility returns.
  useEffect(() => {
    const go = () => { if (document.visibilityState !== "hidden") void q.retry(); };
    window.addEventListener("online", go);
    document.addEventListener("visibilitychange", go);
    return () => { window.removeEventListener("online", go); document.removeEventListener("visibilitychange", go); };
  }, [q]);

  // The server rejected the session: pause, lock the app, keep every record.
  const state = useSyncExternalStore(q.subscribe, q.getState);
  useEffect(() => { if (state.authPaused && user) expire(); }, [state.authPaused, user, expire]);

  return <Ctx.Provider value={q}>{children}</Ctx.Provider>;
}
