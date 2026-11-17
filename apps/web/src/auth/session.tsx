import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { advanceSessionEpoch, api, ApiError, setCsrf } from "../api/client";
import type { BrowserSession, User } from "../api/types";

interface Auth {
  user: User | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** The server stopped accepting this session: lock the app until the next sign-in. */
  expire(): void;
}
const Ctx = createContext<Auth | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("AuthProvider missing");
  return c;
};

async function loadSession(): Promise<BrowserSession | null> {
  try {
    const s = await api<BrowserSession>("GET", "/auth/web/session");
    setCsrf(s.csrfToken);
    return s;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["session"], queryFn: loadSession, retry: false, staleTime: Infinity });
  // Remove everything except the session query that the provider itself observes.
  // Requests still in flight were made for the previous account: invalidate their epoch and cancel them.
  const dropData = () => {
    advanceSessionEpoch();
    const other = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== "session";
    void qc.cancelQueries({ predicate: other });
    qc.removeQueries({ predicate: other });
  };
  const value: Auth = {
    user: q.data?.user ?? null,
    loading: q.isPending,
    async login(username, password) {
      const s = await api<BrowserSession>("POST", "/auth/web/login", { username, password, deviceName: "Web browser" });
      dropData(); // never show another account's cached data
      setCsrf(s.csrfToken);
      await qc.cancelQueries({ queryKey: ["session"] }); // an older session read must not overwrite this one
      qc.setQueryData(["session"], s);
    },
    expire() {
      setCsrf("");
      dropData();
      qc.setQueryData(["session"], null);
    },
    async logout() {
      try { await api<void>("POST", "/auth/web/logout"); } finally {
        setCsrf("");
        dropData(); // protected visible state is dropped on logout
        qc.setQueryData(["session"], null);
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
