import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useListeningSession } from "./useListeningSession";

const sent: { path: string; body: Record<string, unknown> }[] = [];
vi.mock("../api/client", () => ({ api: vi.fn(async (_m: string, path: string, body: Record<string, unknown>) => { sent.push({ path, body }); }) }));

beforeEach(() => { sent.length = 0; vi.useFakeTimers({ now: new Date("2026-11-26T12:00:00Z") }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const play = (audible: boolean) => renderHook((p: { audible: boolean; at: number }) => useListeningSession("R1", p.audible, p.at), { initialProps: { audible, at: 0.1 } });

test("counts only the time audio plays, and sends on pause under one id", async () => {
  const h = play(false);
  await advance(60_000);
  expect(sent).toHaveLength(0); // nothing while paused

  h.rerender({ audible: true, at: 0.1 });
  await advance(40_000);
  h.rerender({ audible: false, at: 0.2 });
  await advance(120_000); // a short pause stays in the same session and is not counted
  h.rerender({ audible: true, at: 0.2 });
  await advance(20_000);
  h.rerender({ audible: false, at: 0.3 });

  const last = sent.at(-1)!;
  expect(last.body.listenedSeconds).toBe(60);
  expect(new Set(sent.map((s) => s.path)).size).toBe(1);
  expect(last.path).toMatch(/^\/recordings\/R1\/listening-sessions\/[0-9a-f-]{36}$/);
  expect(last.body.startFraction).toBe(0.1);
});

test("a pause of more than thirty minutes starts a new session", async () => {
  const h = play(true);
  await advance(10_000);
  h.rerender({ audible: false, at: 0.1 });
  await advance(31 * 60_000);
  h.rerender({ audible: true, at: 0.1 });
  await advance(10_000);
  h.rerender({ audible: false, at: 0.1 });
  expect(new Set(sent.map((s) => s.path)).size).toBe(2);
  expect(sent.at(-1)!.body.listenedSeconds).toBe(10);
});

test("a stretch shorter than five seconds is not sent", async () => {
  const h = play(true);
  await advance(3_000);
  h.rerender({ audible: false, at: 0.1 });
  expect(sent).toHaveLength(0);
});
