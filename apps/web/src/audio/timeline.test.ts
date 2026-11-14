import { describe, expect, test } from "vitest";
import { fmt, locate, startOffsets, toWhole, totalMs } from "./timeline";

const files = [{ id: "a", durationMs: 60_000 }, { id: "b", durationMs: 90_000 }, { id: "c", durationMs: 30_000 }];

describe("timeline", () => {
  test("offsets and total", () => {
    expect(startOffsets(files)).toEqual([0, 60_000, 150_000]);
    expect(totalMs(files)).toBe(180_000);
  });
  test("locate finds the file and offset, with file boundaries belonging to the next file", () => {
    expect(locate(files, 0)).toEqual({ index: 0, offsetMs: 0 });
    expect(locate(files, 59_999)).toEqual({ index: 0, offsetMs: 59_999 });
    expect(locate(files, 60_000)).toEqual({ index: 1, offsetMs: 0 });
    expect(locate(files, 155_000)).toEqual({ index: 2, offsetMs: 5_000 });
  });
  test("locate clamps into the recording", () => {
    expect(locate(files, -5)).toEqual({ index: 0, offsetMs: 0 });
    expect(locate(files, 999_999)).toEqual({ index: 2, offsetMs: 29_999 });
    expect(locate([], 10)).toEqual({ index: 0, offsetMs: 0 });
  });
  test("toWhole round-trips and clamps the offset to the file", () => {
    expect(toWhole(files, 1, 10_000)).toBe(70_000);
    expect(toWhole(files, 1, 500_000)).toBe(150_000);
    for (const t of [0, 1, 59_999, 60_000, 123_456, 179_999]) {
      const l = locate(files, t);
      expect(toWhole(files, l.index, l.offsetMs)).toBe(t);
    }
  });
  test("fmt", () => {
    expect(fmt(0)).toBe("0:00");
    expect(fmt(61_000)).toBe("1:01");
    expect(fmt(3_661_000)).toBe("1:01:01");
    expect(fmt(-5)).toBe("0:00");
  });
});
