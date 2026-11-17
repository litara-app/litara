import { afterEach, expect, test, vi } from "vitest";
import { advanceSessionEpoch, api, StaleSessionError } from "./client";

afterEach(() => vi.unstubAllGlobals());

test("a response requested before the account changed is discarded", async () => {
  let release: (r: Response) => void = () => {};
  vi.stubGlobal("fetch", () => new Promise<Response>((r) => { release = r; }));
  const pending = api("GET", "/titles");
  advanceSessionEpoch(); // another account signs in while the request is in flight
  release({ ok: true, status: 200, json: async () => ({ items: ["account A data"] }) } as Response);
  await expect(pending).rejects.toBeInstanceOf(StaleSessionError);
});

test("a request made after the change is delivered", async () => {
  vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) }) as Response);
  advanceSessionEpoch();
  await expect(api("GET", "/titles")).resolves.toEqual({ ok: 1 });
});

test.each([200, 401, 403, 409, 412])("an old account's delayed %i never reaches the new account's queue listeners", async (status) => {
  const { PendingQueue } = await import("../pending/queue");
  const { MemoryStore } = await import("../pending/store");
  const store = new MemoryStore();
  let release!: (r: Response) => void;
  let started!: () => void;
  const sending = new Promise<void>((r) => { started = r; });
  vi.stubGlobal("fetch", () => new Promise<Response>((r) => { release = r; started(); }));
  const queue = new PendingQueue(store, (op) => api(op.method, op.path, op.body));
  const sent = vi.fn(), conflict = vi.fn(), blocked = vi.fn();
  queue.onSent(sent); queue.onConflict(conflict); queue.onBlocked(blocked);
  await queue.setScope("server|A");
  const op = await queue.enqueue({
    id: "old-operation", kind: "position", resourceKey: "edition", editionId: "edition",
    method: "PUT", path: "/position", label: "place", confirmedRevision: 0,
    body: (baseRevision) => ({ operationId: "old-operation", baseRevision }),
  });
  await sending;
  advanceSessionEpoch();
  await queue.setScope("server|B");
  release(new Response(JSON.stringify({ code: "position_conflict", conflictId: "private-A" }), { status }));
  await new Promise((r) => setTimeout(r, 0));
  expect(queue.getState()).toMatchObject({ scope: "server|B", items: [], authPaused: false });
  expect(sent).not.toHaveBeenCalled();
  expect(conflict).not.toHaveBeenCalled();
  expect(blocked).not.toHaveBeenCalled();
  expect((await store.list("server|A")).map((o) => o.id)).toEqual([op.id]);
  await queue.setScope(null); // clear the scheduled retry
});

test("a session switch while the response body is loading discards the old body", async () => {
  let release!: (body: unknown) => void;
  let started!: () => void;
  const reading = new Promise<void>((r) => { started = r; });
  vi.stubGlobal("fetch", async () => ({
    ok: true, status: 200,
    json: () => new Promise((r) => { release = r; started(); }),
  }) as Response);
  const pending = api("GET", "/titles");
  await reading;
  advanceSessionEpoch();
  release({ items: ["private-A"] });
  await expect(pending).rejects.toBeInstanceOf(StaleSessionError);
});
