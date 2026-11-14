import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { api, ApiError, setCsrf } from "../api/client";
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
  const dropData = () => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
  const value: Auth = {
    user: q.data?.user ?? null,
    loading: q.isPending,
    async login(username, password) {
      const s = await api<BrowserSession>("POST", "/auth/web/login", { username, password, deviceName: "Web browser" });
      setCsrf(s.csrfToken);
      dropData(); // never show another account's cached data
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
