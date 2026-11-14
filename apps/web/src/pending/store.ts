// Durable storage for pending personal-state writes (ADR-0068). Records are
// scoped to server origin + account; a record is never read, sent or shown
// under another scope. Nothing is pruned automatically.

export type OpStatus = "pending" | "conflict" | "blocked" | "failed";

export interface PendingOp {
  /** The original operation ID, reused on every retry so the server can replay. */
  id: string;
  scope: string;
  kind: "annotation" | "position";
  /** Writes to one resource are sent in order and stop at the first problem. */
  resourceKey: string;
  editionId: string;
  method: "PUT" | "DELETE";
  path: string;
  /** The exact body, with the original base revision and content version. */
  body: Record<string, unknown>;
  label: string;
  baseRevision: number;
  createdAt: number;
  attempts: number;
  status: OpStatus;
  error?: string;
  /** Server problem body for conflicts (conflictId, currentRevision, ...). */
  problem?: Record<string, unknown>;
}

export interface PendingStore {
  put(op: PendingOp): Promise<void>;
  delete(id: string): Promise<void>;
  list(scope: string): Promise<PendingOp[]>;
  /** True when records survive a reload. */
  readonly durable: boolean;
}

export class MemoryStore implements PendingStore {
  readonly durable = false;
  private m = new Map<string, PendingOp>();
  async put(op: PendingOp) { this.m.set(op.id, structuredClone(op)); }
  async delete(id: string) { this.m.delete(id); }
  async list(scope: string) { return [...this.m.values()].filter((o) => o.scope === scope).map((o) => structuredClone(o)); }
}

const DB = "litara-pending";
const STORE = "ops";

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "id" });
      s.createIndex("scope", "scope");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class IndexedDbStore implements PendingStore {
  readonly durable = true;
  private db: Promise<IDBDatabase>;
  constructor(factory: IDBFactory = indexedDB) { this.db = open(factory); }
  private async tx(mode: IDBTransactionMode) { return (await this.db).transaction(STORE, mode).objectStore(STORE); }
  async put(op: PendingOp) { await done((await this.tx("readwrite")).put(op)); }
  async delete(id: string) { await done((await this.tx("readwrite")).delete(id)); }
  async list(scope: string) { return done((await this.tx("readonly")).index("scope").getAll(scope)) as Promise<PendingOp[]>; }
}

/** IndexedDB when available, otherwise a memory store (which does not survive reload). */
export function defaultStore(): PendingStore {
  try {
    if (typeof indexedDB !== "undefined") return new IndexedDbStore();
  } catch { /* private mode or blocked storage */ }
  return new MemoryStore();
}
