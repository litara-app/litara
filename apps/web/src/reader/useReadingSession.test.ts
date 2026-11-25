import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useReadingSession } from "./useReadingSession";

const api = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
vi.mock("../api/client", () => ({ api: (...a: unknown[]) => api(...a) }));

beforeEach(() => { vi.useFakeTimers(); api.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

const sent = () => api.mock.calls.map((c) => ({ path: String(c[1]), body: c[2] as { activeSeconds: number; startFraction?: number; endFraction?: number } }));
const idOf = (path: string) => path.split("/").pop();
const poke = () => window.dispatchEvent(new Event("pointerdown"));

test("a reading session is sent under one id while active, and a long pause starts a new one", () => {
  const { rerender, unmount } = renderHook(({ f }) => useReadingSession("E1", f, true), { initialProps: { f: 0.1 } });
  for (let i = 0; i < 7; i++) { act(() => { poke(); vi.advanceTimersByTime(5000); }); } // 35 s of activity
  const first = sent();
  expect(first.length).toBeGreaterThan(0);
  expect(first[0]!.path).toMatch(/^\/editions\/E1\/reading-sessions\/[0-9a-f-]{36}$/);
  expect(first[0]!.body.activeSeconds).toBeGreaterThanOrEqual(20);
  expect(first[0]!.body.startFraction).toBeCloseTo(0.1);

  rerender({ f: 0.2 }); // turning the page is activity and moves the end
  for (let i = 0; i < 7; i++) { act(() => { poke(); vi.advanceTimersByTime(5000); }); }
  const second = sent();
  const last = second[second.length - 1]!;
  expect(idOf(last.path)).toBe(idOf(first[0]!.path)); // the same session
  expect(last.body.endFraction).toBeCloseTo(0.2);
  expect(last.body.activeSeconds).toBeGreaterThan(first[0]!.body.activeSeconds);

  act(() => { vi.advanceTimersByTime(31 * 60_000); }); // walked away
  for (let i = 0; i < 7; i++) { act(() => { poke(); vi.advanceTimersByTime(5000); }); }
  const third = sent();
  expect(idOf(third[third.length - 1]!.path)).not.toBe(idOf(first[0]!.path)); // a new session
  unmount();
});

test("nothing is sent for a book that is only opened, or while the reader is not enabled", () => {
  const { unmount } = renderHook(() => useReadingSession("E1", null, false));
  act(() => { poke(); vi.advanceTimersByTime(60_000); });
  expect(api).not.toHaveBeenCalled();
  unmount();
  const b = renderHook(() => useReadingSession("E1", 0.5, true));
  act(() => { vi.advanceTimersByTime(2000); });
  b.unmount(); // closed within seconds of opening, with no real reading
  expect(api).not.toHaveBeenCalled();
});
