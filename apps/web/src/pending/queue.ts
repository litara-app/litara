import { ApiError } from "../api/client";
import type { PendingOp, PendingStore } from "./store";

export type Send = (op: PendingOp) => Promise<unknown>;

export interface QueueState {
  scope: string | null;
  items: PendingOp[];
  /** Sending is paused until the same account signs in again. */
  authPaused: boolean;
  /** The last send failed for a transient reason; a retry is scheduled. */
  offline: boolean;
  durable: boolean;
}

type Listener = () => void;
type SentHandler = (op: PendingOp, response: unknown) => void;
type ProblemHandler = (op: PendingOp, problem: Record<string, unknown>) => void;

const BACKOFF = [2000, 5000, 15000, 30000, 60000];

/**
 * Pending personal-state writes (ADR-0068): stored before they are sent, sent
 * in order per resource with their original operation IDs and base revisions,
 * and kept (never silently dropped) when they conflict, lose access or fail.
 */
export class PendingQueue {
  private scope: string | null = null;
  private cache: PendingOp[] = [];
  private authPaused = false;
  private offline = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private backoffUntil = 0;
  private listeners = new Set<Listener>();
  private sentHandlers = new Set<SentHandler>();
  private conflictHandlers = new Set<ProblemHandler>();
  private blockedHandlers = new Set<ProblemHandler>();
  private snapshot: QueueState;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private store: PendingStore, private send: Send, private now: () => number = Date.now) {
    this.snapshot = this.compute();
  }

  // ---- state ----------------------------------------------------------------
  private compute(): QueueState {
    return { scope: this.scope, items: this.cache, authPaused: this.authPaused, offline: this.offline, durable: this.store.durable };
  }
  private publish() { this.snapshot = this.compute(); this.listeners.forEach((l) => l()); }
  getState = (): QueueState => this.snapshot;
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  onSent(h: SentHandler) { this.sentHandlers.add(h); return () => { this.sentHandlers.delete(h); }; }
  /** A write was refused because access was removed (403); the record is kept, locked. */
  onBlocked(h: ProblemHandler) { this.blockedHandlers.add(h); return () => { this.blockedHandlers.delete(h); }; }
  onConflict(h: ProblemHandler) { this.conflictHandlers.add(h); return () => { this.conflictHandlers.delete(h); }; }

  /**
   * Bind the queue to the signed-in account. Another account's records are
   * neither loaded nor sent; with no account the queue is locked.
   */
  async setScope(scope: string | null) {
    clearTimeout(this.timer);
    this.scope = scope;
    this.cache = [];
    this.authPaused = false;
    this.offline = false;
    this.failures = 0;
    this.backoffUntil = 0;
    this.publish();
    if (!scope) return;
    const items = await this.store.list(scope);
    if (this.scope !== scope) return; // switched again while loading
    this.cache = items.sort((a, b) => a.createdAt - b.createdAt);
    this.publish();
    void this.flush();
  }

  /** Called after a successful sign-in of the same scope. */
  resume() { this.authPaused = false; this.publish(); void this.flush(); }

  // ---- writing ----------------------------------------------------------------
  forKey(resourceKey: string) { return this.cache.filter((o) => o.resourceKey === resourceKey); }

  /**
   * Store one write before sending it. baseFor chooses the revision: the
   * confirmed server revision, or one past the last queued write to the same
   * resource (each accepted write increments it by one). coalesce replaces a
   * never-sent pending write to the same resource (positions: latest wins).
   */
  enqueue(spec: Omit<PendingOp, "scope" | "createdAt" | "attempts" | "status" | "baseRevision" | "body"> & {
    confirmedRevision: number; coalesce?: boolean; body: (baseRevision: string) => Record<string, unknown>;
  }): Promise<PendingOp> {
    // Revision allocation reads the queued chain and then writes to storage: run enqueues one at a
    // time so two writes to one resource can never be given the same base revision.
    const scope = this.scope; // fixed now, not when the queue gets to it
    const run = this.lock.then(() => this.enqueueNow(scope, spec));
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async enqueueNow(scope: string | null, spec: Parameters<PendingQueue["enqueue"]>[0]): Promise<PendingOp> {
    // The record belongs to the account that made the change, even if another signs in meanwhile.
    if (!scope) throw new Error("not signed in");
    const { confirmedRevision, coalesce, body, ...rest } = spec;
    // The queued chain for this account: from memory when it is active, otherwise from its stored records.
    const chain = this.scope === scope
      ? this.forKey(spec.resourceKey)
      : (await this.store.list(scope)).filter((o) => o.resourceKey === spec.resourceKey).sort((x, y) => x.createdAt - y.createdAt);
    const last = chain[chain.length - 1];
    // Only an unsent write may be replaced, and never while a send run could be holding it.
    if (coalesce && last && last.status === "pending" && last.attempts === 0 && !this.running && this.scope === scope) {
      const written = await this.put(scope, { ...rest, baseRevision: last.baseRevision, body: body(String(last.baseRevision)) }, last.id);
      return written;
    }
    const base = last ? last.baseRevision + 1 : confirmedRevision;
    return this.put(scope, { ...rest, baseRevision: base, body: body(String(base)) });
  }

  /** Store a write (durably, before any send); `replaces` is removed only after the new record exists. */
  private async put(scope: string, p: Omit<PendingOp, "scope" | "createdAt" | "attempts" | "status">, replaces?: string): Promise<PendingOp> {
    const op: PendingOp = { ...p, scope, createdAt: this.now(), attempts: 0, status: "pending" };
    await this.store.put(op);
    if (replaces) await this.store.delete(replaces);
    if (this.scope !== scope) return op; // another account is active now: the record waits, untouched, for its owner
    this.cache = [...this.cache.filter((o) => o.id !== replaces), op];
    this.publish();
    void this.flush();
    return op;
  }

  // ---- sending ------------------------------------------------------------------
  async flush(force = false): Promise<void> {
    if (this.running || !this.scope || this.authPaused) return;
    if (!force && this.now() < this.backoffUntil) return; // a retry is already scheduled
    this.running = true;
    clearTimeout(this.timer);
    const scope = this.scope;
    try {
      const halted = new Set<string>();
      let again = true;
      while (again) { // writes enqueued while sending are picked up in the same run
        again = false;
        for (const op of [...this.cache].sort((a, b) => a.createdAt - b.createdAt)) {
          if (this.scope !== scope) return;
          if (op.status !== "pending") { halted.add(op.resourceKey); continue; }
          if (halted.has(op.resourceKey)) continue;
          const outcome = await this.attempt(op);
          if (outcome === "stop") return;
          if (outcome === "halt") halted.add(op.resourceKey);
          again = true; // the record is gone or settled; look again for writes added meanwhile
        }
      }
      this.offline = false;
      this.failures = 0;
      this.publish();
    } finally {
      this.running = false;
    }
  }

  private async attempt(op: PendingOp): Promise<"ok" | "halt" | "stop"> {
    op.attempts += 1;
    await this.store.put(op);
    try {
      const response = await this.send(op);
      await this.store.delete(op.id);
      this.cache = this.cache.filter((o) => o.id !== op.id);
      this.publish();
      this.sentHandlers.forEach((h) => h(op, response));
      return "ok";
    } catch (e) {
      if (!(e instanceof ApiError)) return this.transient(); // network failure: not saved, retry later
      const s = e.status;
      if (s === 401) { this.authPaused = true; this.publish(); return "stop"; } // pause; keep everything
      if (s === 429 || s >= 500) return this.transient();
      if (s === 409 || s === 412) return this.settle(op, "conflict", e);
      if (s === 403) return this.settle(op, "blocked", e); // access was removed: lock, never discard
      return this.settle(op, "failed", e);
    }
  }

  private async settle(op: PendingOp, status: PendingOp["status"], e: ApiError): Promise<"halt"> {
    op.status = status;
    op.error = e.message;
    op.problem = e.problem as Record<string, unknown>;
    await this.store.put(op);
    this.publish();
    if (status === "conflict") this.conflictHandlers.forEach((h) => h(op, op.problem ?? {}));
    if (status === "blocked") this.blockedHandlers.forEach((h) => h(op, op.problem ?? {}));
    return "halt";
  }

  private transient(): "stop" {
    this.offline = true;
    this.publish();
    const delay = BACKOFF[Math.min(this.failures, BACKOFF.length - 1)];
    this.failures += 1;
    this.backoffUntil = this.now() + delay;
    this.timer = setTimeout(() => void this.flush(), delay);
    return "stop";
  }

  /** Retry now (also for a record the user chose to try again). */
  async retry(id?: string) {
    if (id) {
      const op = this.cache.find((o) => o.id === id);
      if (op && op.status !== "pending") { op.status = "pending"; op.error = undefined; await this.store.put(op); }
    }
    this.failures = 0;
    this.backoffUntil = 0;
    this.publish();
    await this.flush(true);
  }

  /** Remove a record the user explicitly decided to drop (or that a conflict resolution settled). */
  async discard(id: string) {
    await this.store.delete(id);
    this.cache = this.cache.filter((o) => o.id !== id);
    this.publish();
    void this.flush();
  }
}
