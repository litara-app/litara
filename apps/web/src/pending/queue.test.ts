import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../api/client";
import { PendingQueue } from "./queue";
import { IndexedDbStore, MemoryStore, type PendingOp, type PendingStore } from "./store";

const A = "https://litara.test|user-a";
const B = "https://litara.test|user-b";

type Sent = { id: string; body: Record<string, unknown> };

function harness(store: PendingStore = new MemoryStore()) {
  const sent: Sent[] = [];
  let behavior: (op: PendingOp) => Promise<unknown> = async () => ({ revision: "1" });
  const q = new PendingQueue(store, async (op) => { sent.push({ id: op.id, body: op.body }); return behavior(op); });
  return { q, sent, store, set: (b: typeof behavior) => { behavior = b; } };
}

let n = 0;
const spec = (key: string, confirmed: number, extra: Partial<{ coalesce: boolean; kind: "annotation" | "position" }> = {}) => {
  const id = `op-${++n}`;
  return { id, kind: extra.kind ?? "annotation", resourceKey: key, editionId: "ed", method: "PUT" as const, path: "/x", label: "L", confirmedRevision: confirmed,
    coalesce: extra.coalesce, body: (base: string) => ({ operationId: id, baseRevision: base, v: id }) };
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const err = (status: number, extra: Record<string, unknown> = {}) => new ApiError(status, { status, code: "x", detail: "d", ...extra });

beforeEach(() => { vi.useRealTimers(); });

describe("pending queue ownership and ordering", () => {
  /** A store whose writes complete slowly, so enqueues overlap the way they do in a busy page. */
  class SlowStore extends MemoryStore {
    async put(op: PendingOp) { await new Promise((r) => setTimeout(r, 5)); return super.put(op); }
    async delete(id: string) { await new Promise((r) => setTimeout(r, 5)); return super.delete(id); }
  }

  test("simultaneous writes to one resource get distinct, consecutive base revisions", async () => {
    const h = harness(new SlowStore());
    await h.q.setScope(A);
    h.set(() => new Promise(() => undefined)); // nothing is ever accepted, so the chain keeps growing
    const ops = await Promise.all([h.q.enqueue(spec("k", 7)), h.q.enqueue(spec("k", 7)), h.q.enqueue(spec("k", 7))]);
    expect(ops.map((o) => o.baseRevision)).toEqual([7, 8, 9]);
  });

  test("a write started under one account stays that account's if another signs in before it is stored", async () => {
    const h = harness(new SlowStore());
    await h.q.setScope(A);
    h.set(() => new Promise(() => undefined));
    const mine = h.q.enqueue(spec("k", 0));
    await h.q.setScope(B); // account switch while the write is being stored
    const op = await mine;
    expect(op.scope).toBe(A);
    expect(h.q.getState().items).toHaveLength(0); // not shown to, and not sent as, account B
    expect((await h.store.list(A)).map((o) => o.id)).toEqual([op.id]);
    expect(await h.store.list(B)).toHaveLength(0);
    await h.q.setScope(A); // the owner returns and finds it
    expect(h.q.getState().items.map((o) => o.id)).toEqual([op.id]);
  });
});

describe("pending queue", () => {
  test("stores before sending and removes after the server accepts", async () => {
    const h = harness();
    await h.q.setScope(A);
    let storedWhileSending = 0;
    h.set(async () => { storedWhileSending = (await h.store.list(A)).length; return { revision: "1" }; });
    await h.q.enqueue(spec("k", 0));
    await settle();
    expect(storedWhileSending).toBe(1);
    expect(await h.store.list(A)).toHaveLength(0);
    expect(h.sent).toHaveLength(1);
  });

  test("a network failure keeps the write and retries it with the same operation ID and base revision", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.q.setScope(A);
    let fail = true;
    h.set(async () => { if (fail) throw new TypeError("Failed to fetch"); return { revision: "5" }; });
    const op = await h.q.enqueue(spec("k", 4));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.q.getState().offline).toBe(true);
    expect(h.q.getState().items).toHaveLength(1); // never shown as saved
    fail = false;
    await vi.advanceTimersByTimeAsync(2100);
    expect(h.sent.map((s) => s.id)).toEqual([op.id, op.id]);
    expect(h.sent[0].body).toEqual(h.sent[1].body);
    expect(h.sent[1].body.baseRevision).toBe("4");
    expect(h.q.getState().items).toHaveLength(0);
    expect(h.q.getState().offline).toBe(false);
  });

  test("writes to one resource chain their base revisions and stay in order", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.q.setScope(A);
    h.set(async () => { throw new TypeError("offline"); });
    await h.q.enqueue(spec("k", 3));
    await h.q.enqueue(spec("k", 3));
    await h.q.enqueue(spec("other", 0));
    expect(h.q.getState().items.map((o) => o.baseRevision)).toEqual([3, 4, 0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(1); // stops at the first transient failure, preserving order
  });

  test("a position that may already have been applied is chained, not replaced", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.q.setScope(A);
    h.set(async () => { throw new TypeError("offline"); });
    const first = await h.q.enqueue(spec("pos", 7, { coalesce: true, kind: "position" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.q.forKey("pos")[0].attempts).toBe(1); // the response may have been lost
    const second = await h.q.enqueue(spec("pos", 7, { coalesce: true, kind: "position" }));
    expect(second.baseRevision).toBe(8);
    expect(h.q.forKey("pos").map((o) => o.id)).toEqual([first.id, second.id]);
  });

  test("coalescing replaces an unsent position and keeps the original base", async () => {
    const h = harness();
    await h.q.setScope(A);
    (h.q as unknown as { flush: () => Promise<void> }).flush = async () => {}; // hold sending
    const a = await h.q.enqueue(spec("pos", 9, { coalesce: true, kind: "position" }));
    const b = await h.q.enqueue(spec("pos", 9, { coalesce: true, kind: "position" }));
    const items = h.q.forKey("pos");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(b.id);
    expect(b.baseRevision).toBe(a.baseRevision);
    expect((await h.store.list(A)).map((o) => o.id)).toEqual([b.id]);
  });

  test("a conflict is kept with its problem, halts only that resource and notifies", async () => {
    const h = harness();
    await h.q.setScope(A);
    const seen: string[] = [];
    h.q.onConflict((op) => seen.push(op.id));
    h.set(async (op) => { if (op.resourceKey === "bad") throw err(409, { conflictId: "c1", currentRevision: "6" }); return { revision: "1" }; });
    const bad1 = await h.q.enqueue(spec("bad", 0));
    const bad2 = await h.q.enqueue(spec("bad", 0));
    await h.q.enqueue(spec("good", 0));
    await settle();
    await settle();
    const items = h.q.getState().items;
    expect(items.find((o) => o.id === bad1.id)?.status).toBe("conflict");
    expect(items.find((o) => o.id === bad1.id)?.problem?.conflictId).toBe("c1");
    expect(items.filter((o) => o.resourceKey === "bad")).toHaveLength(2); // the later write waits behind it
    expect(items.filter((o) => o.resourceKey === "good")).toHaveLength(0); // other resources still send
    expect(seen).toEqual([bad1.id]);
    expect(h.sent.filter((s) => s.id === bad2.id)).toHaveLength(0);
  });

  test("a 403 locks the write instead of dropping it, and a 401 pauses everything", async () => {
    const h = harness();
    await h.q.setScope(A);
    const blocked: string[] = [];
    h.q.onBlocked((o, problem) => blocked.push(`${o.id}:${String(problem.code)}`));
    h.set(async () => { throw err(403, { code: "library_access_denied" }); });
    const op = await h.q.enqueue(spec("k", 0));
    await settle();
    expect(blocked).toEqual([`${op.id}:library_access_denied`]); // the UI is told so it can clear protected content
    expect(h.q.getState().items[0]).toMatchObject({ id: op.id, status: "blocked" });
    expect(await h.store.list(A)).toHaveLength(1);

    const h2 = harness();
    await h2.q.setScope(A);
    h2.set(async () => { throw err(401); });
    await h2.q.enqueue(spec("k", 0));
    await settle();
    expect(h2.q.getState().authPaused).toBe(true);
    expect(h2.q.getState().items).toHaveLength(1);
    h2.set(async () => ({ revision: "1" }));
    h2.q.resume();
    await settle();
    expect(h2.q.getState().items).toHaveLength(0);
  });

  test("records are scoped to the account: locked at sign-out, never sent as another user, restored for the same user", async () => {
    const store = new IndexedDbStore();
    const h = harness(store);
    await h.q.setScope(A);
    h.set(async () => { throw new TypeError("offline"); });
    const mine = await h.q.enqueue(spec("k", 0));
    await settle();
    await settle();
    expect(h.q.getState().offline).toBe(true);

    await h.q.setScope(null); // sign-out: locked
    expect(h.q.getState().items).toHaveLength(0);
    await expect(h.q.enqueue(spec("k", 0))).rejects.toThrow();

    await h.q.setScope(B); // another account never sees or sends them
    h.set(async () => ({ revision: "1" }));
    await settle();
    expect(h.q.getState().items).toHaveLength(0);
    expect(h.sent).toHaveLength(1); // only the failed attempt made under A
    expect(h.sent[0].id).toBe(mine.id);

    // A reload (new queue over the same IndexedDB) for the same account restores and sends the original write.
    const reload = harness(new IndexedDbStore());
    await reload.q.setScope(A);
    await settle();
    await settle();
    expect(reload.sent.map((s) => s.id)).toEqual([mine.id]);
    expect(reload.sent[0].body.operationId).toBe(mine.id);
    expect(await store.list(A)).toHaveLength(0);
  });

  test("retry brings a failed write back and discard removes it only on request", async () => {
    const h = harness();
    await h.q.setScope(A);
    h.set(async () => { throw err(422); });
    const op = await h.q.enqueue(spec("k", 0));
    await settle();
    expect(h.q.getState().items[0].status).toBe("failed");
    h.set(async () => ({ revision: "1" }));
    await h.q.retry(op.id);
    expect(h.q.getState().items).toHaveLength(0);
    h.set(async () => { throw err(409, { conflictId: "c" }); });
    const op2 = await h.q.enqueue(spec("k2", 0));
    await settle();
    expect(h.q.getState().items).toHaveLength(1);
    await h.q.discard(op2.id);
    expect(await h.store.list(A)).toHaveLength(0);
  });
});
