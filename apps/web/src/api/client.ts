import type { ProblemBody } from "./types";

// Same-origin API client (ADR-0069). Browser sessions use the HttpOnly cookie;
// unsafe methods add the session-bound CSRF token. No credentials are stored
// in script-readable storage.

export class ApiError extends Error {
  constructor(public status: number, public problem: ProblemBody) {
    super(problem.detail || problem.title || `HTTP ${status}`);
  }
  get code(): string { return this.problem.code ?? ""; }
}

let csrf = "";
export function setCsrf(token: string) { csrf = token; }

export const API = "/api/v1";

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRF-Token"] = csrf;
    if (body !== undefined) headers["Content-Type"] = "application/json";
  }
  const res = await fetch(API + path, {
    method, headers, credentials: "same-origin", cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) throw new ApiError(res.status, (data as ProblemBody) ?? {});
  return data as T;
}

export const get = <T>(path: string) => api<T>("GET", path);

/** Fields every T005 personal mutation carries. */
export function op(baseRevision: string) {
  return { operationId: crypto.randomUUID(), baseRevision, capturedAt: new Date().toISOString() };
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
