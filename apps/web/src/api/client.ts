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

/**
 * Generation of the browser session. It advances on every sign-in, sign-out and
 * expiry, so a response requested under an earlier session is recognised and
 * discarded instead of reaching the account that signed in since.
 */
let epoch = 0;
export const sessionEpoch = () => epoch;
export function advanceSessionEpoch() { epoch += 1; }

/** A response that belongs to an earlier session; callers must not use it. */
export class StaleSessionError extends Error {
  constructor() { super("The signed-in account changed while this request was in flight."); this.name = "StaleSessionError"; }
}
/** Throws when the session changed since `since` was read. */
export function assertSameSession(since: number) { if (since !== epoch) throw new StaleSessionError(); }

export const API = "/api/v1";

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRF-Token"] = csrf;
    if (body !== undefined) headers["Content-Type"] = "application/json";
  }
  const since = epoch;
  const res = await fetch(API + path, {
    method, headers, credentials: "same-origin", cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assertSameSession(since);
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  assertSameSession(since);
  if (!res.ok) throw new ApiError(res.status, (data as ProblemBody) ?? {});
  return data as T;
}

/** Send a file as the request body (an image upload); the response is read like any other. */
export async function uploadFile<T>(method: string, path: string, file: File): Promise<T> {
  const since = epoch;
  const res = await fetch(API + path, {
    method, credentials: "same-origin", cache: "no-store", body: file,
    headers: { Accept: "application/json", "X-CSRF-Token": csrf, "Content-Type": file.type || "application/octet-stream" },
  });
  assertSameSession(since);
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

/** Operation ID and base revision only (administrator bodies carry no capturedAt). */
export function adminOp(baseRevision: string) {
  return { operationId: crypto.randomUUID(), baseRevision };
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
